<?php

namespace App\Services;

use App\Events\TransactionPaid;
use App\Mail\SendEmail;
use App\Models\AffiliateEarning;
use App\Models\Certificate;
use App\Models\CertificateParticipant;
use App\Models\CertificationProgramApplication;
use App\Models\Invoice;
use App\Models\User;
use App\Traits\MessaraTrait;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class PaymentSettlementService
{
    use MessaraTrait;

    /**
     * Settle an invoice payment atomically and idempotently.
     *
     * @param Invoice $invoice
     * @param array $paymentData [
     *     'paid_at' => Carbon|string|null,
     *     'payment_method' => string|null,
     *     'payment_channel' => string|null,
     *     'payment_reference' => string|null,
     *     'va_number' => string|null,
     *     'qr_code_url' => string|null,
     *     'amount' => float|int|string|null,
     *     'currency' => string|null
     * ]
     * @return bool True if settled or already paid
     * @throws \InvalidArgumentException
     */
    public function settle(Invoice $invoice, array $paymentData = []): bool
    {
        // 1. Validasi nominal dan mata uang jika disertakan dalam callback
        if (isset($paymentData['amount'])) {
            $providedAmount = (float) $paymentData['amount'];
            $invoiceAmount = (float) $invoice->amount;
            if (abs($providedAmount - $invoiceAmount) > 0.01) {
                throw new \InvalidArgumentException(
                    "Nominal pembayaran (" . number_format($providedAmount, 2) . ") tidak sesuai dengan invoice (" . number_format($invoiceAmount, 2) . ")."
                );
            }
        }

        if (isset($paymentData['currency']) && strtoupper((string) $paymentData['currency']) !== 'IDR') {
            throw new \InvalidArgumentException("Mata uang pembayaran tidak didukung: {$paymentData['currency']}.");
        }

        return DB::transaction(function () use ($invoice, $paymentData) {
            /** @var Invoice|null $lockedInvoice */
            $lockedInvoice = Invoice::where('id', $invoice->id)->lockForUpdate()->first();
            if (!$lockedInvoice) {
                return false;
            }

            // 2. Idempotensi: Jika invoice sudah lunas, jangan jalankan side effect berulang
            if ($lockedInvoice->status === 'paid') {
                Log::info('Payment settlement: Invoice already paid (idempotent)', [
                    'invoice_code' => $lockedInvoice->invoice_code,
                    'reference' => $paymentData['payment_reference'] ?? $lockedInvoice->payment_reference,
                ]);
                return true;
            }

            $paidAt = isset($paymentData['paid_at'])
                ? ($paymentData['paid_at'] instanceof Carbon ? $paymentData['paid_at'] : Carbon::parse($paymentData['paid_at']))
                : Carbon::now('Asia/Jakarta');

            $updateData = [
                'status' => 'paid',
                'paid_at' => $paidAt,
            ];

            if (!empty($paymentData['payment_method'])) {
                $updateData['payment_method'] = $paymentData['payment_method'];
            }
            if (!empty($paymentData['payment_channel'])) {
                $updateData['payment_channel'] = $paymentData['payment_channel'];
            }
            if (!empty($paymentData['payment_reference'])) {
                $updateData['payment_reference'] = $paymentData['payment_reference'];
            }
            if (!empty($paymentData['va_number'])) {
                $updateData['va_number'] = $paymentData['va_number'];
            }
            if (!empty($paymentData['qr_code_url'])) {
                $updateData['qr_code_url'] = $paymentData['qr_code_url'];
            }

            $lockedInvoice->update($updateData);

            // 3. Eksekusi handler cicilan vs tagihan reguler
            if ($lockedInvoice->isInstallmentChild()) {
                $this->settleInstallmentChild($lockedInvoice);
            } else {
                $this->settleRegularInvoice($lockedInvoice);
            }

            return true;
        });
    }

    /**
     * Mark an invoice as failed / expired / cancelled.
     * Prevents downgrading an already paid invoice.
     *
     * @param Invoice $invoice
     * @param string $reason
     * @param string|null $rawStatus
     * @return bool True if marked as failed, False if ignored because invoice was already paid
     */
    public function fail(Invoice $invoice, string $reason, ?string $rawStatus = null): bool
    {
        return DB::transaction(function () use ($invoice, $reason, $rawStatus) {
            /** @var Invoice|null $lockedInvoice */
            $lockedInvoice = Invoice::where('id', $invoice->id)->lockForUpdate()->first();
            if (!$lockedInvoice) {
                return false;
            }

            // Larang penurunan status jika invoice sudah lunas
            if ($lockedInvoice->status === 'paid') {
                Log::warning('Payment settlement: Attempted to mark already paid invoice as failed. Downgrade prevented.', [
                    'invoice_code' => $lockedInvoice->invoice_code,
                    'reason' => $reason,
                    'raw_status' => $rawStatus,
                ]);
                return false;
            }

            if ($lockedInvoice->status === 'failed') {
                return true;
            }

            // Refund poin jika invoice ini menggunakan redeem poin
            if ($lockedInvoice->points_redeemed > 0) {
                try {
                    app(PointService::class)->refundPoints($lockedInvoice);
                } catch (\Throwable $e) {
                    Log::error('Gagal refund poin untuk invoice: ' . $lockedInvoice->invoice_code, ['error' => $e->getMessage()]);
                }
            }

            // Kembalikan kuota voucher/diskon
            if ($lockedInvoice->discountUsage) {
                $discountCode = $lockedInvoice->discountUsage->discountCode;
                if ($discountCode) {
                    $discountCode->decrement('used_count');
                }
                $lockedInvoice->discountUsage->delete();
            }

            $lockedInvoice->update([
                'status' => 'failed',
                'paid_at' => null,
            ]);

            Log::info('Payment marked as failed', [
                'invoice_code' => $lockedInvoice->invoice_code,
                'reason' => $reason,
                'raw_status' => $rawStatus,
            ]);

            // Kirim notifikasi WhatsApp untuk pembayaran gagal
            $this->sendWhatsAppPaymentFailed($lockedInvoice, $rawStatus ?: $reason);

            return true;
        });
    }

    /**
     * Handle a refunded transaction safely according to its current status.
     * - If pending: marks as failed and refunds redeemed points / discount quota.
     * - If paid: revokes product access, cleans up certificate participants and affiliate/mentor commissions,
     *   refunds redeemed points / discount quota, and marks the invoice as failed.
     */
    public function refund(Invoice $invoice, array $refundData = []): bool
    {
        return DB::transaction(function () use ($invoice, $refundData) {
            /** @var Invoice|null $lockedInvoice */
            $lockedInvoice = Invoice::with([
                'courseItems',
                'bootcampItems',
                'webinarItems',
                'certificationProgramItems',
                'bundleEnrollments.bundle.bundleItems',
                'discountUsage.discountCode',
            ])->where('id', $invoice->id)->lockForUpdate()->first();

            if (!$lockedInvoice) {
                return false;
            }

            if ($lockedInvoice->status === 'failed') {
                return true;
            }

            if ($lockedInvoice->status === 'pending') {
                return $this->fail($lockedInvoice, 'Payment refunded while pending', 'REFUND');
            }

            // Jika sebelumnya sudah PAID, cabut hak akses, sertifikat, dan komisi affiliate/mentor
            $userId = $lockedInvoice->user_id;

            foreach ($lockedInvoice->courseItems as $item) {
                $item->update(['completed_at' => null]);
                $this->revokeCertificateParticipantIfNoOtherPaid('course', $item->course_id, $userId, $lockedInvoice->id);
            }

            foreach ($lockedInvoice->bootcampItems as $item) {
                $item->update(['completed_at' => null]);
                $this->revokeCertificateParticipantIfNoOtherPaid('bootcamp', $item->bootcamp_id, $userId, $lockedInvoice->id);
            }

            foreach ($lockedInvoice->webinarItems as $item) {
                $item->update(['completed_at' => null]);
                $this->revokeCertificateParticipantIfNoOtherPaid('webinar', $item->webinar_id, $userId, $lockedInvoice->id);
            }

            foreach ($lockedInvoice->certificationProgramItems as $item) {
                $item->update(['completed_at' => null]);
            }

            foreach ($lockedInvoice->bundleEnrollments as $enrollment) {
                $enrollment->update(['completed_at' => null]);
                $bundle = $enrollment->bundle;
                if ($bundle && $bundle->bundleItems) {
                    foreach ($bundle->bundleItems as $bundleItem) {
                        $this->revokeCertificateParticipantIfNoOtherPaid($bundleItem->getTypeSlug(), $bundleItem->bundleable_id, $userId, $lockedInvoice->id);
                    }
                }
            }

            if ($lockedInvoice->isInstallmentChild() && $lockedInvoice->parent_invoice_id) {
                $parentInvoice = Invoice::find($lockedInvoice->parent_invoice_id);
                if ($parentInvoice) {
                    $parentInvoice->update([
                        'status' => 'installment_pending',
                        'access_suspended_at' => Carbon::now('Asia/Jakarta'),
                    ]);
                }
            }

            AffiliateEarning::where('invoice_id', $lockedInvoice->id)->delete();

            if ($lockedInvoice->points_redeemed > 0) {
                try {
                    app(PointService::class)->refundPoints($lockedInvoice);
                } catch (\Throwable $e) {
                    Log::error('Gagal refund poin saat REFUND untuk invoice: ' . $lockedInvoice->invoice_code, ['error' => $e->getMessage()]);
                }
            }

            if ($lockedInvoice->discountUsage) {
                $discountCode = $lockedInvoice->discountUsage->discountCode;
                if ($discountCode) {
                    $discountCode->decrement('used_count');
                }
                $lockedInvoice->discountUsage->delete();
            }

            $lockedInvoice->update([
                'status' => 'failed',
                'paid_at' => null,
            ]);

            Log::warning('Payment refund processed and access revoked', [
                'invoice_code' => $lockedInvoice->invoice_code,
                'reference' => $refundData['reference'] ?? $lockedInvoice->payment_reference,
                'note' => $refundData['note'] ?? null,
            ]);

            return true;
        });
    }

    protected function revokeCertificateParticipantIfNoOtherPaid(string $type, $itemId, $userId, string $excludeInvoiceId): void
    {
        $certificate = match ($type) {
            'course' => Certificate::where('course_id', $itemId)->first(),
            'bootcamp' => Certificate::where('bootcamp_id', $itemId)->first(),
            'webinar' => Certificate::where('webinar_id', $itemId)->first(),
            default => null,
        };

        if (!$certificate) {
            return;
        }

        $relation = match ($type) {
            'course' => ['courseItems', 'course_id'],
            'bootcamp' => ['bootcampItems', 'bootcamp_id'],
            'webinar' => ['webinarItems', 'webinar_id'],
            default => null,
        };

        if (!$relation) {
            return;
        }

        [$relName, $fieldName] = $relation;
        $hasOtherPaid = Invoice::where('user_id', $userId)
            ->where('id', '!=', $excludeInvoiceId)
            ->where('status', 'paid')
            ->whereHas($relName, fn($q) => $q->where($fieldName, $itemId))
            ->exists();

        if (!$hasOtherPaid) {
            CertificateParticipant::where('certificate_id', $certificate->id)
                ->where('user_id', $userId)
                ->delete();
        }
    }

    /**
     * Handle installment child settlement.
     */
    protected function settleInstallmentChild(Invoice $childInvoice): void
    {
        $parentInvoice = Invoice::with([
            'user',
            'courseItems.course',
            'bootcampItems.bootcamp',
            'webinarItems.webinar',
            'certificationProgramItems.certificationProgram',
            'bundleEnrollments.bundle',
        ])->find($childInvoice->parent_invoice_id);

        if ($parentInvoice) {
            // Jika termin ke-1 (DP): aktifkan akses
            if ($childInvoice->installment_number === 1) {
                $this->activateInstallmentEnrollments($parentInvoice);
            }

            // Pulihkan akses jika sebelumnya dibekukan
            $parentInvoice->update(['access_suspended_at' => null]);

            // Catat komisi affiliate untuk termin ini
            $this->recordAffiliateCommission($childInvoice);

            // Cek apakah semua termin lunas
            if ($parentInvoice->isFullyPaid()) {
                $parentInvoice->update(['status' => 'paid', 'paid_at' => Carbon::now('Asia/Jakarta')]);
                $this->addEnrollmentToCertificateParticipants($parentInvoice);
                event(new TransactionPaid($parentInvoice));
                $this->sendWhatsAppInstallmentComplete($parentInvoice, $childInvoice);
            } else {
                $this->sendWhatsAppTermPaid($childInvoice, $parentInvoice);
            }
        }
    }

    /**
     * Handle regular invoice settlement.
     */
    protected function settleRegularInvoice(Invoice $invoice): void
    {
        $this->processInvoiceEnrollments($invoice);
        $this->recordAffiliateCommission($invoice);

        // Dispatch event untuk reward referral & transaksi lunas
        event(new TransactionPaid($invoice));

        $this->sendEmailNotification($invoice);
        $this->sendWhatsAppNotification($invoice);
    }

    /**
     * Process enrollments setelah pembayaran sukses
     */
    public function processInvoiceEnrollments(Invoice $invoice, bool $includeCertificateParticipants = true): void
    {
        $invoice->loadMissing([
            'courseItems',
            'bootcampItems',
            'webinarItems',
            'certificationProgramItems',
            'bundleEnrollments.bundle.bundleItems.bundleable'
        ]);

        $userId = $invoice->user_id;

        if ($invoice->courseItems->count() > 0) {
            foreach ($invoice->courseItems as $item) {
                $item->update([
                    'completed_at' => Carbon::now('Asia/Jakarta')
                ]);
                if ($includeCertificateParticipants) {
                    $this->addToCertificateParticipants('course', $item->course_id, $userId);
                }
            }
        }

        if ($invoice->bootcampItems->count() > 0) {
            foreach ($invoice->bootcampItems as $item) {
                $item->update([
                    'completed_at' => Carbon::now('Asia/Jakarta')
                ]);
                if ($includeCertificateParticipants) {
                    $this->addToCertificateParticipants('bootcamp', $item->bootcamp_id, $userId);
                }
            }
        }

        if ($invoice->webinarItems->count() > 0) {
            foreach ($invoice->webinarItems as $item) {
                $item->update([
                    'completed_at' => Carbon::now('Asia/Jakarta')
                ]);
                if ($includeCertificateParticipants) {
                    $this->addToCertificateParticipants('webinar', $item->webinar_id, $userId);
                }
            }
        }

        if ($invoice->certificationProgramItems->count() > 0) {
            foreach ($invoice->certificationProgramItems as $item) {
                $item->update([
                    'completed_at' => Carbon::now('Asia/Jakarta')
                ]);
            }
        }

        if ($invoice->bundleEnrollments->count() > 0) {
            foreach ($invoice->bundleEnrollments as $enrollment) {
                $enrollment->update([
                    'completed_at' => Carbon::now('Asia/Jakarta')
                ]);

                if (method_exists($enrollment, 'createIndividualEnrollments')) {
                    $enrollment->createIndividualEnrollments();
                }

                if ($includeCertificateParticipants) {
                    $bundle = $enrollment->bundle;
                    if ($bundle && $bundle->bundleItems) {
                        foreach ($bundle->bundleItems as $bundleItem) {
                            $type = method_exists($bundleItem, 'getTypeSlug') ? $bundleItem->getTypeSlug() : null;
                            if ($type) {
                                $this->addToCertificateParticipants($type, $bundleItem->bundleable_id, $userId);
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Aktifkan akses enrollment pada invoice induk cicilan setelah DP dibayar
     */
    public function activateInstallmentEnrollments(Invoice $parentInvoice): void
    {
        $this->processInvoiceEnrollments($parentInvoice, false);

        Log::info('Installment DP paid - access activated', [
            'parent_invoice_code' => $parentInvoice->invoice_code,
            'user_id' => $parentInvoice->user_id,
        ]);
    }

    /**
     * Menambahkan seluruh peserta program & bundle ke certificate participants
     */
    public function addEnrollmentToCertificateParticipants(Invoice $invoice): void
    {
        $invoice->loadMissing([
            'courseItems',
            'bootcampItems',
            'webinarItems',
            'bundleEnrollments.bundle.bundleItems.bundleable',
        ]);

        $userId = $invoice->user_id;

        foreach ($invoice->courseItems as $item) {
            $this->addToCertificateParticipants('course', $item->course_id, $userId);
        }

        foreach ($invoice->bootcampItems as $item) {
            $this->addToCertificateParticipants('bootcamp', $item->bootcamp_id, $userId);
        }

        foreach ($invoice->webinarItems as $item) {
            $this->addToCertificateParticipants('webinar', $item->webinar_id, $userId);
        }

        if ($invoice->bundleEnrollments && $invoice->bundleEnrollments->count() > 0) {
            foreach ($invoice->bundleEnrollments as $bundleEnrollment) {
                $bundle = $bundleEnrollment->bundle;
                if ($bundle && $bundle->bundleItems) {
                    foreach ($bundle->bundleItems as $bundleItem) {
                        $type = method_exists($bundleItem, 'getTypeSlug') ? $bundleItem->getTypeSlug() : null;
                        if ($type) {
                            $this->addToCertificateParticipants($type, $bundleItem->bundleable_id, $userId);
                        }
                    }
                }
            }
        }
    }

    /**
     * Menambahkan peserta ke certificate participants berdasarkan tipe program
     */
    public function addToCertificateParticipants(string $type, $itemId, $userId): void
    {
        $certificate = null;

        switch ($type) {
            case 'course':
                $certificate = Certificate::where('course_id', $itemId)->first();
                break;
            case 'bootcamp':
                $certificate = Certificate::where('bootcamp_id', $itemId)->first();
                break;
            case 'webinar':
                $certificate = Certificate::where('webinar_id', $itemId)->first();
                break;
        }

        if ($certificate) {
            CertificateParticipant::firstOrCreate([
                'certificate_id' => $certificate->id,
                'user_id' => $userId,
            ]);
        }
    }

    /**
     * Catat komisi affiliate untuk invoice
     */
    public function recordAffiliateCommission(Invoice $invoice): void
    {
        if ((float) $invoice->nett_amount <= 0) {
            return;
        }

        if ($invoice->referred_by_user_id) {
            $affiliate = User::find($invoice->referred_by_user_id);

            if ($affiliate && $affiliate->affiliate_status === 'Active' && (float) $affiliate->commission > 0) {
                $commissionAmount = $invoice->nett_amount * ($affiliate->commission / 100);

                AffiliateEarning::firstOrCreate(
                    [
                        'affiliate_user_id' => $affiliate->id,
                        'invoice_id' => $invoice->id,
                    ],
                    [
                        'amount' => $commissionAmount,
                        'rate' => $affiliate->commission,
                        'status' => 'approved',
                    ]
                );
            }
        } else {
            $defaultAffiliate = User::where('affiliate_code', 'LUC2025')->first()
                ?? User::whereHas('roles', fn ($q) => $q->where('name', 'affiliate'))->first();

            if ($defaultAffiliate && $defaultAffiliate->id !== $invoice->user_id) {
                $invoice->update(['referred_by_user_id' => $defaultAffiliate->id]);

                if ($defaultAffiliate->affiliate_status === 'Active' && (float) $defaultAffiliate->commission > 0) {
                    $commissionAmount = $invoice->nett_amount * ($defaultAffiliate->commission / 100);

                    AffiliateEarning::firstOrCreate(
                        [
                            'affiliate_user_id' => $defaultAffiliate->id,
                            'invoice_id' => $invoice->id,
                        ],
                        [
                            'amount' => $commissionAmount,
                            'rate' => $defaultAffiliate->commission,
                            'status' => 'approved',
                        ]
                    );
                }
            }
        }

        $this->recordMentorCommission($invoice);
    }

    /**
     * Mencatat komisi untuk mentor dari penjualan kelas mereka
     */
    public function recordMentorCommission(Invoice $invoice): void
    {
        $invoice->loadMissing(['courseItems.course.user']);

        foreach ($invoice->courseItems as $courseItem) {
            $course = $courseItem->course;
            $mentor = $course?->user;

            if ($mentor && $mentor->hasRole('mentor') && $mentor->affiliate_status === 'Active' && (float) $mentor->commission > 0) {
                $commissionAmount = $courseItem->price * ($mentor->commission / 100);

                AffiliateEarning::firstOrCreate(
                    [
                        'affiliate_user_id' => $mentor->id,
                        'invoice_id' => $invoice->id,
                        'type' => 'mentor_course',
                        'course_id' => $course->id,
                    ],
                    [
                        'amount' => $commissionAmount,
                        'rate' => $mentor->commission,
                        'status' => 'approved',
                    ]
                );
            }
        }
    }

    /**
     * Kirim email notifikasi setelah pembayaran berhasil
     */
    public function sendEmailNotification(Invoice $invoice): void
    {
        try {
            $invoice->loadMissing([
                'user',
                'courseItems.course',
                'bootcampItems.bootcamp',
                'webinarItems.webinar',
                'bundleEnrollments.bundle',
                'certificationProgramItems.certificationProgram',
            ]);

            $productType = '';
            $productTitle = '';
            if ($invoice->courseItems->count() > 0) {
                $productType = 'Course';
                $productTitle = $invoice->courseItems->first()->course->title ?? '';
            } elseif ($invoice->bootcampItems->count() > 0) {
                $productType = 'Bootcamp';
                $productTitle = $invoice->bootcampItems->first()->bootcamp->title ?? '';
            } elseif ($invoice->webinarItems->count() > 0) {
                $productType = 'Webinar';
                $productTitle = $invoice->webinarItems->first()->webinar->title ?? '';
            } elseif ($invoice->bundleEnrollments->count() > 0) {
                $productType = 'Bundle';
                $productTitle = $invoice->bundleEnrollments->first()->bundle->title ?? '';
            } elseif ($invoice->certificationProgramItems->count() > 0) {
                $productType = 'Program Sertifikasi';
                $productTitle = $invoice->certificationProgramItems->first()->certificationProgram->title ?? '';
            }

            $user = $invoice->user;
            if (!$user || !$user->email) {
                return;
            }

            $subject = 'Pembayaran Berhasil - ' . $invoice->invoice_code;
            $message = 'Pembayaran Anda untuk ' . $productType . ' "' . $productTitle . '" dengan No Invoice: ' . $invoice->invoice_code . ' telah berhasil. Total pembayaran: Rp ' . number_format($invoice->amount, 0, ',', '.') . '. Silakan cek dashboard untuk akses produk Anda.';

            Mail::to($user->email)->send(new SendEmail(
                $subject,
                $message,
                $user->name,
                $invoice->id
            ));

            Log::info('Email notification sent', [
                'invoice_code' => $invoice->invoice_code,
                'email' => $user->email
            ]);
        } catch (\Throwable $e) {
            Log::error('Failed to send email notification', [
                'error' => $e->getMessage(),
                'invoice_id' => $invoice->id
            ]);
        }
    }

    /**
     * Kirim notifikasi WhatsApp setelah pembayaran berhasil
     */
    public function sendWhatsAppNotification(Invoice $invoice): void
    {
        try {
            if ($invoice->isInstallmentChild()) {
                $parentInvoice = $invoice->parentInvoice ?? ($invoice->parent_invoice_id ? Invoice::find($invoice->parent_invoice_id) : null);
                if ($parentInvoice) {
                    if ($parentInvoice->isFullyPaid()) {
                        $this->sendWhatsAppInstallmentComplete($parentInvoice, $invoice);
                    } else {
                        $this->sendWhatsAppTermPaid($invoice, $parentInvoice);
                    }
                }
                return;
            }

            if ($invoice->isInstallmentParent()) {
                if ($invoice->isFullyPaid()) {
                    $this->sendWhatsAppInstallmentComplete($invoice);
                }
                return;
            }

            $invoice->loadMissing([
                'user',
                'courseItems.course',
                'bootcampItems.bootcamp',
                'webinarItems.webinar',
                'bundleEnrollments.bundle.bundleItems',
                'certificationProgramItems.certificationProgram',
                'discountUsage.discountCode',
            ]);

            $user = $invoice->user;
            if (!$user || !$user->phone_number) {
                return;
            }

            $phoneNumber = $this->formatPhoneNumber($user->phone_number);
            $message = $this->createWhatsAppSuccessMessage($invoice);

            $waData = [
                [
                    'phone' => $phoneNumber,
                    'message' => $message,
                    'isGroup' => 'false',
                ]
            ];

            self::sendText($waData);
        } catch (\Throwable $e) {
            Log::error('Failed to send WhatsApp notification', [
                'invoice_code' => $invoice->invoice_code,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function getPhoneNumberForInvoice(Invoice $invoice): ?string
    {
        if ($invoice->user && !empty($invoice->user->phone_number)) {
            return $invoice->user->phone_number;
        }

        if ($invoice->certificationProgramItems && $invoice->certificationProgramItems->count() > 0) {
            $certItem = $invoice->certificationProgramItems->first();
            $application = CertificationProgramApplication::where('certification_program_id', $certItem->certification_program_id)
                ->where('user_id', $invoice->user_id)
                ->latest()
                ->first();
            if ($application && !empty($application->phone)) {
                return $application->phone;
            }
        }

        return null;
    }

    /**
     * Kirim WhatsApp saat satu termin cicilan berhasil dibayar
     */
    public function sendWhatsAppTermPaid(Invoice $childInvoice, Invoice $parentInvoice): void
    {
        try {
            $parentInvoice->loadMissing(['user', 'certificationProgramItems']);
            $rawPhone = $this->getPhoneNumberForInvoice($parentInvoice);
            if (!$rawPhone) {
                return;
            }

            $phoneNumber = $this->formatPhoneNumber($rawPhone);
            $message = $this->createWhatsAppInstallmentMessage($childInvoice, $parentInvoice, false);

            self::sendText([['phone' => $phoneNumber, 'message' => $message, 'isGroup' => 'false']]);
        } catch (\Throwable $e) {
            Log::error('Failed to send WhatsApp term paid', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Kirim WhatsApp saat semua termin cicilan lunas
     */
    public function sendWhatsAppInstallmentComplete(Invoice $parentInvoice, ?Invoice $lastChildInvoice = null): void
    {
        try {
            $parentInvoice->loadMissing(['user', 'certificationProgramItems']);
            $rawPhone = $this->getPhoneNumberForInvoice($parentInvoice);
            if (!$rawPhone) {
                return;
            }

            $childInvoice = $lastChildInvoice ?? $parentInvoice->installmentTerms()->orderByDesc('installment_number')->first();
            if (!$childInvoice) {
                $childInvoice = $parentInvoice;
            }

            $phoneNumber = $this->formatPhoneNumber($rawPhone);
            $message = $this->createWhatsAppInstallmentMessage($childInvoice, $parentInvoice, true);

            self::sendText([['phone' => $phoneNumber, 'message' => $message, 'isGroup' => 'false']]);
        } catch (\Throwable $e) {
            Log::error('Failed to send WhatsApp installment complete', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Kirim notifikasi WhatsApp untuk pembayaran gagal
     */
    public function sendWhatsAppPaymentFailed(Invoice $invoice, ?string $rawStatus = null): void
    {
        try {
            $invoice->loadMissing([
                'user',
                'courseItems.course',
                'bootcampItems.bootcamp',
                'webinarItems.webinar',
                'bundleEnrollments.bundle',
                'certificationProgramItems.certificationProgram',
            ]);

            $user = $invoice->user;
            if (!$user || !$user->phone_number) {
                return;
            }

            $phoneNumber = $this->formatPhoneNumber($user->phone_number);

            $itemType = 'Program';
            if ($invoice->courseItems->count() > 0) {
                $itemType = 'Kelas Online';
            } elseif ($invoice->bootcampItems->count() > 0) {
                $itemType = 'Bootcamp';
            } elseif ($invoice->webinarItems->count() > 0) {
                $itemType = 'Webinar';
            } elseif ($invoice->bundleEnrollments->count() > 0) {
                $itemType = 'Bundle';
            } elseif ($invoice->certificationProgramItems->count() > 0) {
                $itemType = 'Sertifikasi Program';
            }

            $statusText = $rawStatus ? " (status: {$rawStatus})" : '';

            $message = "*[Level Up Accounting - Pembayaran {$itemType} Gagal]*\n\n";
            $message .= "Hai *{$user->name}*,\n\n";
            $message .= "Maaf, pembayaran {$itemType} untuk invoice *{$invoice->invoice_code}* tidak berhasil atau telah kadaluarsa{$statusText}.\n\n";
            $message .= "Silakan melakukan pembelian ulang jika Anda masih berminat.\n\n";
            $message .= "Terima kasih atas perhatiannya.\n\n";
            $message .= "*Level Up Accounting Customer Support*";

            $waData = [
                [
                    'phone' => $phoneNumber,
                    'message' => $message,
                    'isGroup' => 'false',
                ]
            ];

            self::sendText($waData);
        } catch (\Throwable $e) {
            Log::error('Failed to send WhatsApp payment failed notification', [
                'invoice_code' => $invoice->invoice_code,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Format WhatsApp phone number
     */
    public function formatPhoneNumber(string $phoneNumber): string
    {
        $phoneNumber = preg_replace('/[^0-9]/', '', $phoneNumber);

        if (str_starts_with($phoneNumber, '0')) {
            $phoneNumber = '62' . substr($phoneNumber, 1);
        }

        if (!str_starts_with($phoneNumber, '62')) {
            $phoneNumber = '62' . $phoneNumber;
        }

        return $phoneNumber;
    }

    /**
     * Buat template pesan WhatsApp sukses
     */
    public function createWhatsAppSuccessMessage(Invoice $invoice): string
    {
        $user = $invoice->user;
        $loginUrl = route('login');
        $profileUrl = route('profile.index');

        $invoice->loadMissing([
            'user',
            'courseItems.course',
            'bootcampItems.bootcamp',
            'webinarItems.webinar',
            'bundleEnrollments.bundle.bundleItems.bundleable',
            'certificationProgramItems.certificationProgram',
            'discountUsage.discountCode',
        ]);

        $itemType = null;
        $typeInfo = [
            'icon' => '📘',
            'name' => 'Program',
            'menu' => 'Dashboard',
            'title' => '-',
            'item' => null,
        ];

        if ($invoice->bundleEnrollments->count() > 0) {
            $itemType = 'bundle';
            $bundle = $invoice->bundleEnrollments->first()->bundle;

            $typeInfo = [
                'icon' => '📦',
                'name' => 'Paket Bundling',
                'menu' => 'Dashboard',
                'title' => $bundle->title ?? '-',
                'item' => $bundle,
            ];
        } elseif ($invoice->courseItems->count() > 0) {
            $itemType = 'course';
            $course = $invoice->courseItems->first()->course;

            $typeInfo = [
                'icon' => '📚',
                'name' => 'Kelas Online',
                'menu' => 'Kelas Saya',
                'title' => $course->title ?? '-',
                'item' => $course,
            ];
        } elseif ($invoice->bootcampItems->count() > 0) {
            $itemType = 'bootcamp';
            $bootcamp = $invoice->bootcampItems->first()->bootcamp;

            $typeInfo = [
                'icon' => '🎯',
                'name' => 'Bootcamp',
                'menu' => 'Bootcamp Saya',
                'title' => $bootcamp->title ?? '-',
                'item' => $bootcamp,
            ];
        } elseif ($invoice->webinarItems->count() > 0) {
            $itemType = 'webinar';
            $webinar = $invoice->webinarItems->first()->webinar;

            $typeInfo = [
                'icon' => '📺',
                'name' => 'Webinar',
                'menu' => 'Webinar Saya',
                'title' => $webinar->title ?? '-',
                'item' => $webinar,
            ];
        } elseif ($invoice->certificationProgramItems->count() > 0) {
            $itemType = 'certification_program';
            $program = $invoice->certificationProgramItems->first()->certificationProgram;

            $typeInfo = [
                'icon' => '🧾',
                'name' => 'Sertifikasi Program',
                'menu' => 'Sertifikasi Saya',
                'title' => $program->title ?? '-',
                'item' => $program,
            ];
        }

        $message = "*[Level Up Accounting - Pembayaran {$typeInfo['name']} Berhasil]* 🎉\n\n";
        $message .= "Hai *{$user->name}*,\n\n";
        $message .= "Terima kasih! Pembayaran Anda untuk {$typeInfo['name']} telah berhasil diverifikasi.\n\n";
        $message .= "*Detail Pembayaran:*\n";
        $message .= "🧾 No. Invoice: *{$invoice->invoice_code}*\n";
        $message .= "{$typeInfo['icon']} {$typeInfo['name']}: *{$typeInfo['title']}*\n";
        if (!empty($user->phone_number)) {
            $message .= "📱 No. WA: *{$user->phone_number}*\n";
        }

        if ($itemType === 'bundle') {
            $bundle = $typeInfo['item'];
            if ($bundle) {
                $count = $bundle->bundle_items_count ?? ($bundle->bundleItems ? $bundle->bundleItems->count() : 0);
                $message .= "📦 Berisi: *{$count} Program*\n";
            }
        }

        if ($invoice->discountUsage && $invoice->discountUsage->discountCode) {
            $discountCode = $invoice->discountUsage->discountCode;
            $message .= "🏷️ Kode Promo: *{$discountCode->code}* (-Rp " . number_format((int) $invoice->discountUsage->discount_amount, 0, ',', '.') . ")\n";
        }

        $message .= "💰 Total Pembayaran: *Rp " . number_format($invoice->amount, 0, ',', '.') . "*\n";
        $paidTime = $invoice->paid_at ? Carbon::parse($invoice->paid_at)->format('d M Y H:i') : Carbon::now('Asia/Jakarta')->format('d M Y H:i');
        $message .= "📅 Waktu Pembayaran: {$paidTime} WIB\n\n";

        $message .= "*Cara Mengakses Materi:*\n";
        $message .= "1. Login ke akun Anda: {$loginUrl}\n";
        $message .= "2. Kunjungi dashboard: {$profileUrl}\n";
        if ($itemType === 'bundle') {
            $message .= "3. Semua program sudah bisa diakses dari menu masing-masing\n";
            $message .= "4. Mulai belajar dan raih sertifikat untuk setiap program! 🎓\n\n";

            $bundle = $typeInfo['item'];
            $hasGroupUrl = false;
            $groupLinks = "";

            if ($bundle && $bundle->bundleItems) {
                foreach ($bundle->bundleItems as $bItem) {
                    $program = $bItem->bundleable;
                    if ($program && !empty($program->group_url)) {
                        $hasGroupUrl = true;
                        $groupLinks .= "👥 {$program->title}:\n{$program->group_url}\n\n";
                    }
                }
            }

            if ($hasGroupUrl) {
                $message .= "*Join Group Pelatihan:*\n";
                $message .= $groupLinks;
                $message .= "⚠️ *Penting:*\n";
                $message .= "• Bergabung dengan group untuk mendapatkan info penting dan diskusi\n";
                $message .= "• Aktif mengikuti seluruh kegiatan program\n\n";
            }
        } else {
            $message .= "3. Pilih menu '{$typeInfo['menu']}'\n";
            $message .= "4. Mulai belajar dan raih sertifikat! 🎓\n\n";
        }

        if ($itemType === 'course') {
            $course = $typeInfo['item'];
            if ($course && !empty($course->group_url)) {
                $message .= "*Join Group Kelas:*\n";
                $message .= "👥 {$course->group_url}\n\n";
                $message .= "⚠️ *Penting:*\n";
                $message .= "• Bergabung dengan group untuk mendapatkan info materi dan diskusi\n\n";
            }
        } elseif ($itemType === 'webinar') {
            $webinar = $typeInfo['item'];
            if ($webinar && !empty($webinar->start_time)) {
                $startTime = Carbon::parse($webinar->start_time);
                $message .= "*Jadwal Webinar:*\n";
                $message .= "📅 {$startTime->format('d M Y')}\n";
                $message .= "🕐 {$startTime->format('H:i')} WIB\n\n";
            }

            if (!empty($webinar?->group_url)) {
                $message .= "*Join Group Webinar:*\n";
                $message .= "👥 {$webinar->group_url}\n\n";
                $message .= "⚠️ *Penting:* \n";
                $message .= "• Bergabung dengan group untuk update terbaru\n";
                $message .= "• Jangan lupa attend sesuai jadwal!\n\n";
            } else {
                $message .= "⚠️ *Penting:* Jangan lupa bergabung sesuai jadwal!\n\n";
            }
        } elseif ($itemType === 'bootcamp') {
            $bootcamp = $typeInfo['item'];
            if ($bootcamp && !empty($bootcamp->start_date) && !empty($bootcamp->end_date)) {
                $startDate = Carbon::parse($bootcamp->start_date);
                $endDate = Carbon::parse($bootcamp->end_date);
                $message .= "*Periode Bootcamp:*\n";
                $message .= "📅 {$startDate->format('d M Y')} - {$endDate->format('d M Y')}\n\n";
            }

            if (!empty($bootcamp?->group_url)) {
                $message .= "*Join Group Bootcamp:*\n";
                $message .= "👥 {$bootcamp->group_url}\n\n";
                $message .= "⚠️ *Penting:* \n";
                $message .= "• Bergabung dengan group untuk mendapatkan info penting dan diskusi\n";
                $message .= "• Aktif mengikuti seluruh kegiatan bootcamp\n\n";
            }
        } elseif ($itemType === 'certification_program') {
            $program = $typeInfo['item'];

            if (!empty($program?->group_url)) {
                $message .= "*Join Group Sertifikasi:*\n";
                $message .= "👥 {$program->group_url}\n\n";
                $message .= "⚠️ *Penting:*\n";
                $message .= "• Bergabung dengan group untuk mendapatkan info penting\n";
                $message .= "• Ikuti jadwal program yang tersedia\n\n";
            }

            if (!empty($program?->socialization_group_url)) {
                $message .= "*Join Group Sosialisasi:*\n";
                $message .= "👥 {$program->socialization_group_url}\n\n";
            }
        }

        $message .= "Jika Anda memiliki pertanyaan, hubungi Admin kami via WhatsApp di *6287775764475*.\n\n";
        $message .= "Selamat belajar! 🚀\n";
        $message .= "*Level Up Accounting Support*";

        return $message;
    }

    /**
     * Buat template pesan WhatsApp cicilan
     */
    public function createWhatsAppInstallmentMessage(Invoice $childInvoice, Invoice $parentInvoice, bool $isCompleted = false): string
    {
        $parentInvoice->loadMissing([
            'user',
            'courseItems.course',
            'bootcampItems.bootcamp',
            'webinarItems.webinar',
            'certificationProgramItems.certificationProgram',
            'bundleEnrollments.bundle.bundleItems.bundleable',
            'installmentTerms',
        ]);

        $user = $parentInvoice->user;
        $loginUrl = route('login');
        $profileUrl = route('profile.index');
        $installmentUrl = route('profile.installments');

        $itemType = null;
        $typeInfo = [
            'icon' => '📘',
            'name' => 'Program',
            'menu' => 'Dashboard',
            'title' => 'Program Level Up Accounting',
            'item' => null,
        ];

        if ($parentInvoice->bundleEnrollments && $parentInvoice->bundleEnrollments->count() > 0) {
            $itemType = 'bundle';
            $bundle = $parentInvoice->bundleEnrollments->first()?->bundle;
            $typeInfo = [
                'icon' => '📦',
                'name' => 'Paket Bundling',
                'menu' => 'Dashboard',
                'title' => $bundle?->title ?? '-',
                'item' => $bundle,
            ];
        } elseif ($parentInvoice->courseItems && $parentInvoice->courseItems->count() > 0) {
            $itemType = 'course';
            $course = $parentInvoice->courseItems->first()?->course;
            $typeInfo = [
                'icon' => '📚',
                'name' => 'Kelas Online',
                'menu' => 'Kelas Saya',
                'title' => $course?->title ?? '-',
                'item' => $course,
            ];
        } elseif ($parentInvoice->bootcampItems && $parentInvoice->bootcampItems->count() > 0) {
            $itemType = 'bootcamp';
            $bootcamp = $parentInvoice->bootcampItems->first()?->bootcamp;
            $typeInfo = [
                'icon' => '🎯',
                'name' => 'Bootcamp',
                'menu' => 'Bootcamp Saya',
                'title' => $bootcamp?->title ?? '-',
                'item' => $bootcamp,
            ];
        } elseif ($parentInvoice->webinarItems && $parentInvoice->webinarItems->count() > 0) {
            $itemType = 'webinar';
            $webinar = $parentInvoice->webinarItems->first()?->webinar;
            $typeInfo = [
                'icon' => '📺',
                'name' => 'Webinar',
                'menu' => 'Webinar Saya',
                'title' => $webinar?->title ?? '-',
                'item' => $webinar,
            ];
        } elseif ($parentInvoice->certificationProgramItems && $parentInvoice->certificationProgramItems->count() > 0) {
            $itemType = 'certification_program';
            $program = $parentInvoice->certificationProgramItems->first()?->certificationProgram;
            $typeInfo = [
                'icon' => '🧾',
                'name' => 'Sertifikasi Program',
                'menu' => 'Sertifikasi Saya',
                'title' => $program?->title ?? '-',
                'item' => $program,
            ];
        }

        $termNumber = $childInvoice->installment_number ?? 1;
        $totalTerms = $parentInvoice->installmentTerms()->count();
        $nextTerm = method_exists($parentInvoice, 'nextUnpaidTerm') ? $parentInvoice->nextUnpaidTerm() : null;

        if ($isCompleted) {
            $message = "*[Level Up Accounting - Pelunasan Cicilan {$typeInfo['name']} Berhasil]* 🎉\n\n";
            $message .= "Hai *{$user->name}*,\n\n";
            $message .= "Selamat! Pembayaran cicilan ke-{$termNumber} dari {$totalTerms} telah berhasil diproses dan seluruh pembayaran cicilan untuk program *{$typeInfo['title']}* telah *LUNAS*.\n\n";
        } else {
            $isDp = ($termNumber === 1);
            $message = "*[Level Up Accounting - Pembayaran " . ($isDp ? 'DP Cicilan' : 'Cicilan') . " {$typeInfo['name']} Berhasil]* ✅\n\n";
            $message .= "Hai *{$user->name}*,\n\n";
            $message .= "Terima kasih! Pembayaran " . ($isDp ? 'DP (Termin ke-1)' : "Termin ke-{$termNumber}") . " dari {$totalTerms} untuk {$typeInfo['name']} Anda telah berhasil diproses.\n\n";
        }

        $message .= "*Detail Pembayaran:*\n";
        $message .= "🧾 Invoice Termin: *{$childInvoice->invoice_code}*\n";
        $message .= "📋 No. Tagihan Cicilan: *{$parentInvoice->invoice_code}*\n";
        $message .= "{$typeInfo['icon']} {$typeInfo['name']}: *{$typeInfo['title']}*\n";

        if ($itemType === 'bundle') {
            $bundle = $typeInfo['item'];
            if ($bundle) {
                $count = $bundle->bundle_items_count ?? ($bundle->bundleItems ? $bundle->bundleItems->count() : 0);
                $message .= "📦 Berisi: *{$count} Program*\n";
            }
        }

        $message .= "🔢 Status Termin: *Ke-{$termNumber} dari {$totalTerms}*\n";
        $message .= "💰 Nominal Dibayar: *Rp " . number_format($childInvoice->amount, 0, ',', '.') . "*\n";
        $paidTime = $childInvoice->paid_at ? Carbon::parse($childInvoice->paid_at)->format('d M Y H:i') : Carbon::now('Asia/Jakarta')->format('d M Y H:i');
        $message .= "📅 Dibayar: {$paidTime} WIB\n\n";

        if (!$isCompleted && $nextTerm) {
            $nextTermNumber = $nextTerm->installment_number;
            $nextDue = $nextTerm->installment_due_date ? Carbon::parse($nextTerm->installment_due_date)->translatedFormat('d F Y') : '-';
            $message .= "*Informasi Tagihan Selanjutnya:*\n";
            $message .= "⏳ Termin: *Ke-{$nextTermNumber} dari {$totalTerms}*\n";
            $message .= "💰 Nominal: *Rp " . number_format($nextTerm->amount, 0, ',', '.') . "*\n";
            $message .= "📅 Jatuh Tempo: *{$nextDue}*\n";
            $message .= "🔗 Link Pembayaran/Pelunasan: {$installmentUrl}\n\n";
        } elseif ($isCompleted) {
            $message .= "*Status Cicilan:*\n";
            $message .= "🎉 Status: *LUNAS (Semua {$totalTerms} termin selesai)*\n";
            $message .= "🏆 Sertifikat program dapat diakses melalui profil Anda setelah menyelesaikan pembelajaran.\n\n";
        }

        $message .= "*Cara Mengakses Materi:*\n";
        $message .= "1. Login ke akun Anda: {$loginUrl}\n";
        $message .= "2. Kunjungi dashboard: {$profileUrl}\n";
        if ($itemType === 'bundle') {
            $message .= "3. Semua program sudah bisa diakses dari menu masing-masing\n";
            $message .= "4. Mulai belajar dan raih sertifikat untuk setiap program! 🎓\n\n";

            $bundle = $typeInfo['item'];
            $hasGroupUrl = false;
            $groupLinks = "";

            if ($bundle && $bundle->bundleItems) {
                foreach ($bundle->bundleItems as $bItem) {
                    $program = $bItem->bundleable;
                    if ($program && !empty($program->group_url)) {
                        $hasGroupUrl = true;
                        $groupLinks .= "👥 {$program->title}:\n{$program->group_url}\n\n";
                    }
                }
            }

            if ($hasGroupUrl) {
                $message .= "*Join Group Pelatihan:*\n";
                $message .= $groupLinks;
                $message .= "⚠️ *Penting:*\n";
                $message .= "• Bergabung dengan group untuk mendapatkan info penting dan diskusi\n";
                $message .= "• Aktif mengikuti seluruh kegiatan program\n\n";
            }
        } else {
            $message .= "3. Pilih menu '{$typeInfo['menu']}'\n";
            $message .= "4. Mulai belajar dan raih sertifikat! 🎓\n\n";
        }

        if ($itemType === 'course') {
            $course = $typeInfo['item'];
            if ($course && !empty($course->group_url)) {
                $message .= "*Join Group Kelas:*\n";
                $message .= "👥 {$course->group_url}\n\n";
                $message .= "⚠️ *Penting:*\n";
                $message .= "• Bergabung dengan group untuk mendapatkan info materi dan diskusi\n\n";
            }
        } elseif ($itemType === 'webinar') {
            $webinar = $typeInfo['item'];
            if ($webinar && !empty($webinar->start_time)) {
                $startTime = Carbon::parse($webinar->start_time);
                $message .= "*Jadwal Webinar:*\n";
                $message .= "📅 {$startTime->format('d M Y')}\n";
                $message .= "🕐 {$startTime->format('H:i')} WIB\n\n";
            }

            if (!empty($webinar?->group_url)) {
                $message .= "*Join Group Webinar:*\n";
                $message .= "👥 {$webinar->group_url}\n\n";
                $message .= "⚠️ *Penting:* \n";
                $message .= "• Bergabung dengan group untuk update terbaru\n";
                $message .= "• Jangan lupa attend sesuai jadwal!\n\n";
            } else {
                $message .= "⚠️ *Penting:* Jangan lupa bergabung sesuai jadwal!\n\n";
            }
        } elseif ($itemType === 'bootcamp') {
            $bootcamp = $typeInfo['item'];
            if ($bootcamp && !empty($bootcamp->start_date) && !empty($bootcamp->end_date)) {
                $startDate = Carbon::parse($bootcamp->start_date);
                $endDate = Carbon::parse($bootcamp->end_date);
                $message .= "*Periode Bootcamp:*\n";
                $message .= "📅 {$startDate->format('d M Y')} - {$endDate->format('d M Y')}\n\n";
            }

            if (!empty($bootcamp?->group_url)) {
                $message .= "*Join Group Bootcamp:*\n";
                $message .= "👥 {$bootcamp->group_url}\n\n";
                $message .= "⚠️ *Penting:* \n";
                $message .= "• Bergabung dengan group untuk mendapatkan info penting dan diskusi\n";
                $message .= "• Aktif mengikuti seluruh kegiatan bootcamp\n\n";
            }
        } elseif ($itemType === 'certification_program') {
            $program = $typeInfo['item'];

            if (!empty($program?->group_url)) {
                $message .= "*Join Group Sertifikasi:*\n";
                $message .= "👥 {$program->group_url}\n\n";
                $message .= "⚠️ *Penting:*\n";
                $message .= "• Bergabung dengan group untuk mendapatkan info penting\n";
                $message .= "• Ikuti jadwal program yang tersedia\n\n";
            }

            if (!empty($program?->socialization_group_url)) {
                $message .= "*Join Group Sosialisasi:*\n";
                $message .= "👥 {$program->socialization_group_url}\n\n";
            }
        }

        $message .= "Jika Anda memiliki pertanyaan, hubungi Admin kami via WhatsApp di *6287775764475*.\n\n";
        $message .= "Selamat belajar! 🚀\n";
        $message .= "*Level Up Accounting Support*";

        return $message;
    }
}
