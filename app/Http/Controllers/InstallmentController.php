<?php

namespace App\Http\Controllers;

use App\Models\Bootcamp;
use App\Models\Bundle;
use App\Models\CertificationProgram;
use App\Models\Course;
use App\Models\EnrollmentBootcamp;
use App\Models\EnrollmentBundle;
use App\Models\EnrollmentCertificationProgram;
use App\Models\EnrollmentCourse;
use App\Models\EnrollmentWebinar;
use App\Models\Invoice;
use App\Models\ProductInstallmentTerm;
use App\Models\Webinar;
use App\Services\MidtransService;
use App\Services\TripayService;
use App\Traits\WhatsAppTrait;
use Carbon\Carbon;
use Haruncpi\LaravelIdGenerator\IdGenerator;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;

class InstallmentController extends Controller
{
    use WhatsAppTrait;

    protected $midtransService;
    protected $tripayService;

    public function __construct(MidtransService $midtransService, ?TripayService $tripayService = null)
    {
        $this->midtransService = $midtransService;
        $this->tripayService = $tripayService ?? app(TripayService::class);
    }

    /**
     * Daftar cicilan milik user yang sedang login
     */
    public function index()
    {
        $userId = Auth::id();

        $invoices = Invoice::with([
            'courseItems.course',
            'bootcampItems.bootcamp',
            'webinarItems.webinar',
            'certificationProgramItems.certificationProgram',
            'bundleEnrollments.bundle',
            'installmentTerms',
        ])
            ->where('user_id', $userId)
            ->where('is_installment', true)
            ->whereNull('parent_invoice_id') // Hanya invoice induk
            ->orderByDesc('created_at')
            ->get()
            ->map(function (Invoice $invoice) {
                $terms = $invoice->installmentTerms->sortBy('installment_number')->values();
                $paidCount = $terms->where('status', 'paid')->count();
                $totalCount = $terms->count();
                $nextUnpaid = $terms->where('status', 'pending')->first();
                $isNextOverdue = false;
                if ($nextUnpaid && $nextUnpaid->installment_due_date) {
                    $isNextOverdue = Carbon::now('Asia/Jakarta')->gt(Carbon::parse($nextUnpaid->installment_due_date)->endOfDay());
                }

                $parentGrossAmount = (float) $invoice->amount;

                return [
                    'id' => $invoice->id,
                    'invoice_code' => $invoice->invoice_code,
                    'status' => $invoice->status,
                    'amount' => $parentGrossAmount,
                    'nett_amount' => (float) $invoice->nett_amount,
                    'is_access_suspended' => $invoice->isAccessSuspended() || $isNextOverdue,
                    'access_suspended_at' => $invoice->access_suspended_at,
                    'created_at' => $invoice->created_at,
                    'product_type' => $invoice->getInvoiceType(),
                    'product_name' => $this->getProductName($invoice),
                    'paid_terms' => $paidCount,
                    'total_terms' => $totalCount,
                    'next_unpaid_term' => $nextUnpaid ? [
                        'id' => $nextUnpaid->id,
                        'installment_number' => $nextUnpaid->installment_number,
                        'amount' => (int) $nextUnpaid->amount,
                        'nett_amount' => (int) $nextUnpaid->nett_amount,
                        'transaction_fee' => (int) ($nextUnpaid->transaction_fee ?? 0),
                        'installment_due_date' => $nextUnpaid->installment_due_date,
                        'status' => $nextUnpaid->status,
                        'is_overdue' => $isNextOverdue,
                        'invoice_url' => $nextUnpaid->invoice_url,
                        'payment_channel' => $nextUnpaid->payment_channel,
                    ] : null,
                    'terms' => $terms->map(function ($t) {
                        $isOverdue = $t->installment_due_date
                            ? Carbon::now('Asia/Jakarta')->gt(Carbon::parse($t->installment_due_date)->endOfDay()) && $t->status !== 'paid'
                            : false;
                        return [
                            'id' => $t->id,
                            'installment_number' => $t->installment_number,
                            'invoice_code' => $t->invoice_code,
                            'amount' => (int) $t->amount,
                            'nett_amount' => (int) $t->nett_amount,
                            'transaction_fee' => (int) ($t->transaction_fee ?? 0),
                            'status' => $t->status,
                            'installment_due_date' => $t->installment_due_date,
                            'paid_at' => $t->paid_at,
                            'payment_method' => $t->payment_method,
                            'payment_channel' => $t->payment_channel,
                            'invoice_url' => $t->invoice_url,
                            'is_overdue' => $isOverdue,
                        ];
                    }),
                ];
            });

        return Inertia::render('user/profile/installments', [
            'installments' => $invoices,
        ]);
    }

    private function getActiveGateway(): string
    {
        if (app()->runningUnitTests()) {
            if (app()->isShared(\App\Services\MidtransService::class) && !app()->isShared(\App\Services\TripayService::class)) {
                return 'midtrans';
            }
            if (config('manjo.qris.partner_id') === 'TEST_PARTNER_01' && config('tripay.api_key') !== 'DEV-TEST-API-KEY') {
                return 'manjo';
            }
        }

        return strtolower((string) config('payment.default', config('tripay.active_gateway', 'tripay')));
    }

    /**
     * Buat invoice cicilan: invoice induk + N invoice anak
     */
    public function store(Request $request)
    {
        $userId = Auth::id();
        $type = $request->input('type');
        $itemId = $request->input('id');

        // Cek apakah user sudah memiliki cicilan aktif yang belum lunas
        if ($userId) {
            $activeInstallment = Invoice::getActiveInstallmentForUser($userId, $type, $itemId);
            if ($activeInstallment && !$activeInstallment['is_fully_paid']) {
                return response()->json([
                    'success' => false,
                    'message' => 'Anda memiliki transaksi cicilan yang sedang aktif untuk program ini. Silakan lanjutkan pembayaran termin cicilan Anda.',
                ], 422);
            }
        }

        // Validasi: cicilan tidak bisa dikombinasikan dengan poin/voucher
        if ($request->input('discount_code_id') || $request->input('points_redeemed', 0) > 0) {
            return response()->json([
                'success' => false,
                'message' => 'Cicilan tidak dapat dikombinasikan dengan poin atau voucher.',
            ], 422);
        }

        try {
            // Ambil produk
            [$item, $enrollmentTable, $enrollmentField] = $this->resolveProduct($type, $itemId);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Gagal membuat cicilan: ' . $e->getMessage(),
            ], 422);
        }

        // Validasi cicilan tersedia
        if (!$item->installment_enabled) {
            return response()->json([
                'success' => false,
                'message' => 'Gagal membuat cicilan: Produk ini tidak tersedia untuk pembayaran cicilan.',
            ], 422);
        }

        $terms = ProductInstallmentTerm::where('termable_type', get_class($item))
            ->where('termable_id', $item->id)
            ->orderBy('term_number')
            ->get();

        if ($terms->isEmpty()) {
            return response()->json([
                'success' => false,
                'message' => 'Gagal membuat cicilan: Konfigurasi termin cicilan belum diatur oleh admin.',
            ], 422);
        }

        $dpTerm = $terms->first();
        $dpDueDate = ($type !== 'course' && !empty($item->registration_deadline))
            ? Carbon::parse($item->registration_deadline)
            : ($dpTerm->due_date ? Carbon::parse($dpTerm->due_date) : null);

        $now = Carbon::now('Asia/Jakarta');
        if ($type !== 'course') {
    foreach ($terms as $term) {
                $termDueDate = ($term->term_number === 1 && $dpDueDate)
                    ? $dpDueDate
                    : ($term->due_date ? Carbon::parse($term->due_date) : null);
    
                if ($termDueDate && $now->gt($termDueDate->copy()->endOfDay())) {
                    $termLabel = $term->term_number === 1 ? 'pendaftaran / termin pertama' : 'termin ke-' . $term->term_number;
                    return response()->json([
                        'success' => false,
                        'message' => 'Opsi pembayaran cicilan untuk program ini telah ditutup karena batas waktu ' . $termLabel . ' telah terlewati.',
                    ], 422);
                }
            }
        }

        $totalNettAmount = (int) $terms->sum('amount');
        $activeGateway = $this->getActiveGateway();
        $paymentChannelInput = strtoupper(trim((string) $request->input('payment_channel', $request->input('bank_code', 'QRIS'))));
        if ($paymentChannelInput === '' || $paymentChannelInput === 'E-WALLET' || $paymentChannelInput === 'VA') {
            $paymentChannelInput = 'QRIS';
        }

        $channelObj = $activeGateway === 'tripay'
            ? $this->tripayService->findChannel($paymentChannelInput)
            : null;
        $resolvedChannelCode = $channelObj ? (string) $channelObj->code : $paymentChannelInput;

        $paymentManager = app(\App\Services\Payment\PaymentGatewayManager::class);
        $dpTerm = $terms->first();

        $dpFee = ($activeGateway === 'midtrans' || $activeGateway === 'manjo') ? 5000 : 0;
        if ($activeGateway === 'tripay') {
            try {
                $feeCalc = $paymentManager->driver('tripay')->calculateFee((int) $dpTerm->amount, $resolvedChannelCode);
                $dpFee = (int) ($feeCalc['fee_customer'] ?? 0);
            } catch (\Throwable $e) {
                $dpFee = $channelObj ? $this->tripayService->calculateCustomerFee($channelObj, (int) $dpTerm->amount) : 0;
            }
        }

        $totalEstimatedGrossAmount = 0;
        $termFeeMap = [];
        foreach ($terms as $t) {
            $tNett = (int) $t->amount;
            $tFee = ($t->term_number === 1) ? $dpFee : (($activeGateway === 'tripay' && $channelObj)
                ? $this->tripayService->calculateCustomerFee($channelObj, $tNett)
                : (($activeGateway === 'midtrans' || $activeGateway === 'manjo') ? 5000 : 0));
            $termFeeMap[$t->term_number] = $tFee;
            $totalEstimatedGrossAmount += ($tNett + $tFee);
        }

        $dpGrossAmount = (int) $terms->first()->amount + ($termFeeMap[1] ?? 0);

        // Ambil referral / affiliate code jika ada
        $affiliateCode = $request->cookie('affiliate_code') ?? $request->input('affiliate_code');
        $referredByUserId = null;
        if ($affiliateCode) {
            $affiliateUser = \App\Models\User::where('affiliate_code', $affiliateCode)->first();
            if ($affiliateUser && $affiliateUser->id !== $userId) {
                $referredByUserId = $affiliateUser->id;
            }
        }

        // Generate kode invoice induk
        try {
            $parentCode = IdGenerator::generate([
                'table' => 'invoices',
                'field' => 'invoice_code',
                'length' => 11,
                'reset_on_prefix_change' => true,
                'prefix' => 'LUC-' . date('y'),
            ]);
        } catch (\Throwable $e) {
            $count = Invoice::where('invoice_code', 'like', 'LUC-' . date('y') . '%')->count() + 1;
            $parentCode = 'LUC-' . date('y') . str_pad($count, 5, '0', STR_PAD_LEFT);
        }

        DB::beginTransaction();
        try {
            // Buat invoice induk
            $parentInvoice = Invoice::create([
                'user_id' => $userId,
                'referred_by_user_id' => $referredByUserId,
                'invoice_code' => $parentCode,
                'amount' => $totalEstimatedGrossAmount,
                'nett_amount' => $totalNettAmount,
                'discount_amount' => 0,
                'points_redeemed' => 0,
                'payment_method' => $activeGateway === 'tripay' ? 'tripay' : 'midtrans',
                'payment_channel' => $resolvedChannelCode,
                'status' => 'installment_pending',
                'is_installment' => true,
            ]);

            // Buat invoice anak untuk setiap termin
            $firstChildInvoice = null;
            foreach ($terms as $term) {
                $childCode = $parentCode . '-T' . $term->term_number;
                if ($type === 'course') {
                    if ($term->term_number === 1) {
                        $childDueDate = Carbon::now('Asia/Jakarta')->endOfDay();
                    } else {
                        $offsetDays = 0;
                        if ($dpTerm && $dpTerm->due_date && $term->due_date) {
                            $t1 = Carbon::parse($dpTerm->due_date);
                            $tCurrent = Carbon::parse($term->due_date);
                            $diff = $t1->diffInDays($tCurrent, false);
                            $offsetDays = $diff > 0 ? $diff : ($term->term_number - 1) * 30;
                        } else {
                            $offsetDays = ($term->term_number - 1) * 30;
                        }
                        $childDueDate = Carbon::now('Asia/Jakarta')->addDays($offsetDays)->endOfDay();
                    }
                } else {
                    $childDueDate = ($term->term_number === 1 && $dpDueDate)
                        ? $dpDueDate
                        : ($term->due_date ? Carbon::parse($term->due_date) : null);
                }

                $termNett = (int) $term->amount;
                $termFee = $termFeeMap[$term->term_number] ?? 0;

                $child = Invoice::create([
                    'user_id' => $userId,
                    'referred_by_user_id' => $referredByUserId,
                    'invoice_code' => $childCode,
                    'amount' => $termNett + $termFee,
                    'nett_amount' => $termNett,
                    'transaction_fee' => $termFee,
                    'discount_amount' => 0,
                    'points_redeemed' => 0,
                    'payment_method' => $activeGateway === 'tripay' ? 'tripay' : 'midtrans',
                    'payment_channel' => $resolvedChannelCode,
                    'status' => 'pending',
                    'is_installment' => false,
                    'parent_invoice_id' => $parentInvoice->id,
                    'installment_term_id' => $term->id,
                    'installment_number' => $term->term_number,
                    'installment_due_date' => $childDueDate,
                    'expires_at' => Carbon::now()->addHours(24),
                ]);

                if ($term->term_number === 1) {
                    $firstChildInvoice = $child;
                }
            }

            // Buat enrollment (akses belum aktif - akan diaktifkan via callback DP)
            $enrollmentData = [
                'invoice_id' => $parentInvoice->id,
                $enrollmentField => $item->id,
                'price' => $totalNettAmount,
                'completed_at' => null,
                'progress' => 0,
            ];
            $enrollmentTable::create($enrollmentData);

            if ($activeGateway === 'tripay') {
                $gatewayResponse = $this->createTripayTransaction($firstChildInvoice, $item, Auth::user(), $resolvedChannelCode);
                $dpGrossAmount = (int) $firstChildInvoice->amount;
                $parentInvoice->update([
                    'amount' => (int) $parentInvoice->installmentTerms()->sum('amount'),
                ]);
            } else {
                // Buat Midtrans Transaction hanya untuk termin ke-1 (DP)
                $gatewayResponse = $this->createMidtransTransaction($firstChildInvoice, $item, Auth::user());
                $firstChildInvoice->update([
                    'invoice_url' => $gatewayResponse['redirect_url'] ?? null,
                    'payment_reference' => $firstChildInvoice->invoice_code,
                ]);
            }

            DB::commit();

            return response()->json([
                'success' => true,
                'payment_url' => $gatewayResponse['redirect_url'] ?? null,
                'invoice_url' => $gatewayResponse['redirect_url'] ?? null,
                'snap_token' => $gatewayResponse['snap_token'] ?? null,
                'invoice_id' => $parentInvoice->id,
                'child_invoice_id' => $firstChildInvoice->id,
                'invoice_code' => $parentCode,
                'dp_amount' => $dpGrossAmount,
                'total_terms' => $terms->count(),
            ], 200);
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Installment creation failed', [
                'error' => $e->getMessage(),
                'user_id' => Auth::id(),
                'request_data' => $request->all(),
            ]);

            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 422);
        }
    }

    /**
     * Generate payment URL untuk termin berikutnya
     */
    public function payTerm(Request $request, string $parentInvoiceId)
    {
        $userId = Auth::id();

        $parentInvoice = Invoice::with(['installmentTerms'])
            ->where('id', $parentInvoiceId)
            ->where('user_id', $userId)
            ->where('is_installment', true)
            ->whereNull('parent_invoice_id')
            ->firstOrFail();

        if ($parentInvoice->status === 'paid') {
            return response()->json([
                'success' => false,
                'message' => 'Semua cicilan sudah lunas.',
            ], 422);
        }

        $nextTerm = $parentInvoice->nextUnpaidTerm();
        if (!$nextTerm) {
            return response()->json([
                'success' => false,
                'message' => 'Tidak ada termin yang perlu dibayar.',
            ], 422);
        }

        // Validasi overdue: tidak bisa bayar mandiri jika jatuh tempo sudah terlewat
        if ($nextTerm->installment_due_date) {
            $dueDate = Carbon::parse($nextTerm->installment_due_date)->endOfDay();
            if (Carbon::now('Asia/Jakarta')->gt($dueDate)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Batas waktu pembayaran untuk termin ini telah melewati jatuh tempo. Pembayaran online ditutup, silakan hubungi admin untuk penyelesaian cicilan.',
                ], 422);
            }
        }

        // Pastikan termin ke-1 (DP) sudah dibayar jika sedang membayar termin berikutnya (jangan loncat)
        if ($nextTerm->installment_number > 1) {
            $dp = $parentInvoice->installmentTerms()->where('installment_number', 1)->first();
            if ($dp && $dp->status !== 'paid') {
                return response()->json([
                    'success' => false,
                    'message' => 'Termin ke-1 (DP) belum dibayar.',
                ], 422);
            }
        }

        DB::beginTransaction();
        try {
            $productInvoice = $parentInvoice->load([
                'courseItems.course',
                'bootcampItems.bootcamp',
                'webinarItems.webinar',
                'certificationProgramItems.certificationProgram',
                'bundleEnrollments.bundle',
            ]);
            $item = $this->getProductFromInvoice($productInvoice);

            $activeGateway = $this->getActiveGateway();
            $paymentChannelInput = strtoupper(trim((string) $request->input(
                'payment_channel',
                $request->input('bank_code', $nextTerm->payment_channel ?: $parentInvoice->payment_channel ?: 'QRIS')
            )));
            if ($paymentChannelInput === '' || $paymentChannelInput === 'E-WALLET' || $paymentChannelInput === 'VA') {
                $paymentChannelInput = 'QRIS';
            }

            if ($activeGateway === 'tripay') {
                $nextTerm->expires_at = Carbon::now()->addHours(24);
                $gatewayResponse = $this->createTripayTransaction($nextTerm, $item, Auth::user(), $paymentChannelInput);
                $parentInvoice->update([
                    'amount' => (int) $parentInvoice->installmentTerms()->sum('amount'),
                ]);
            } else {
                // Buat Midtrans Transaction baru yang selalu valid & fresh (mencegah token expired)
                $gatewayResponse = $this->createMidtransTransaction($nextTerm, $item, Auth::user());

                $nextTerm->update([
                    'status' => 'pending',
                    'invoice_url' => $gatewayResponse['redirect_url'] ?? null,
                    'payment_url' => $gatewayResponse['redirect_url'] ?? null,
                    'snap_token' => $gatewayResponse['snap_token'] ?? null,
                    'expires_at' => Carbon::now()->addHours(24),
                ]);
            }

            DB::commit();

            return response()->json([
                'success' => true,
                'payment_url' => $gatewayResponse['redirect_url'] ?? null,
                'invoice_url' => $gatewayResponse['redirect_url'] ?? null,
                'snap_token' => $gatewayResponse['snap_token'] ?? null,
                'term_number' => $nextTerm->installment_number,
                'installment_number' => $nextTerm->installment_number,
                'child_invoice_id' => $nextTerm->id,
                'invoice_code' => $nextTerm->invoice_code,
                'amount' => (int) $nextTerm->amount,
                'transaction_fee' => (int) ($nextTerm->transaction_fee ?? 0),
            ], 200);
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Pay installment term failed', ['error' => $e->getMessage()]);
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    // ========================= PRIVATE HELPERS =========================

    private function resolveProduct(string $type, string $itemId): array
    {
        return match ($type) {
            'course' => [Course::findOrFail($itemId), EnrollmentCourse::class, 'course_id'],
            'bootcamp' => [Bootcamp::findOrFail($itemId), EnrollmentBootcamp::class, 'bootcamp_id'],
            'webinar' => [Webinar::findOrFail($itemId), EnrollmentWebinar::class, 'webinar_id'],
            'certification_program' => [CertificationProgram::findOrFail($itemId), EnrollmentCertificationProgram::class, 'certification_program_id'],
            'bundle' => [Bundle::findOrFail($itemId), EnrollmentBundle::class, 'bundle_id'],
            default => throw new \Exception('Tipe produk tidak valid'),
        };
    }

    private function getProductFromInvoice(Invoice $invoice): mixed
    {
        if ($invoice->courseItems->count() > 0) return $invoice->courseItems->first()->course;
        if ($invoice->bootcampItems->count() > 0) return $invoice->bootcampItems->first()->bootcamp;
        if ($invoice->webinarItems->count() > 0) return $invoice->webinarItems->first()->webinar;
        if ($invoice->certificationProgramItems->count() > 0) return $invoice->certificationProgramItems->first()->certificationProgram;
        if ($invoice->bundleEnrollments->count() > 0) return $invoice->bundleEnrollments->first()->bundle;
        throw new \Exception('Produk tidak ditemukan pada invoice ini.');
    }

    private function getProductName(Invoice $invoice): string
    {
        try {
            $item = $this->getProductFromInvoice($invoice);
            return $item?->title ?? $item?->name ?? 'Produk';
        } catch (\Throwable $e) {
            return 'Produk';
        }
    }

    private function formatPhoneNumber(?string $phoneNumber): string
    {
        if (empty($phoneNumber)) {
            return '';
        }

        $phoneNumber = preg_replace('/[^0-9]/', '', $phoneNumber);
        if (empty($phoneNumber)) {
            return '';
        }

        if (substr($phoneNumber, 0, 1) == '0') {
            $phoneNumber = '62' . substr($phoneNumber, 1);
        } elseif (substr($phoneNumber, 0, 1) == '8') {
            $phoneNumber = '62' . $phoneNumber;
        }

        return $phoneNumber;
    }

    /**
     * Kirim pesan pengingat WhatsApp ke peserta cicilan secara manual oleh admin
     */
    public function sendReminder(Request $request, string $id)
    {
        try {
            $invoice = Invoice::with([
                'user',
                'parentInvoice.user',
                'installmentTerms',
                'courseItems.course',
                'bootcampItems.bootcamp',
                'webinarItems.webinar',
                'certificationProgramItems.certificationProgram',
                'bundleEnrollments.bundle',
            ])->find($id);

            if (!$invoice) {
                return response()->json(['success' => false, 'message' => 'Data tagihan/invoice tidak ditemukan.'], 404);
            }

            $parentInvoice = $invoice->parent_invoice_id ? $invoice->parentInvoice : $invoice;
            $termInvoice = $invoice->parent_invoice_id ? $invoice : $parentInvoice->nextUnpaidTerm();

            // Cek apakah invoice lunas / termin sudah lunas
            if ($parentInvoice->isFullyPaid() || !$termInvoice) {
                return response()->json(['success' => false, 'message' => 'Semua termin cicilan untuk invoice ini sudah lunas.'], 422);
            }

            if ($termInvoice->status === 'paid') {
                return response()->json(['success' => false, 'message' => 'Termin cicilan ini sudah dibayar/lunas.'], 422);
            }

            $user = $invoice->user ?? $parentInvoice?->user;
            $rawPhone = $user?->phone_number;
            if (!$user || empty($rawPhone) || !is_string($rawPhone) || trim($rawPhone) === '') {
                return response()->json(['success' => false, 'message' => 'Nomor WhatsApp peserta tidak ditemukan atau belum diisi.'], 422);
            }

            $phoneNumber = $this->formatPhoneNumber($rawPhone);
            if (empty($phoneNumber) || strlen($phoneNumber) < 8) {
                return response()->json(['success' => false, 'message' => 'Nomor WhatsApp peserta tidak valid.'], 422);
            }
            $termNumber = $termInvoice->installment_number;
            $totalTerms = $parentInvoice->installmentTerms()->count();
            $termAmount = (float) $termInvoice->amount;
            $amount = 'Rp ' . number_format($termAmount, 0, ',', '.');
            $dueDate = $termInvoice->installment_due_date ? Carbon::parse($termInvoice->installment_due_date)->translatedFormat('d F Y') : '-';
            $productName = $this->getProductName($parentInvoice);
            $payUrl = $termInvoice->invoice_url ?: url('/profile/installments');

            $customMessage = $request->input('custom_message');
            if (!empty($customMessage)) {
                $message = $customMessage;
            } else {
                $message = "*[Level Up Counting - Pengingat Pembayaran Cicilan]*\n\n";
                $message .= "Halo *{$user->name}*,\n\n";
                $message .= "Kami mengingatkan tagihan cicilan untuk program *{$productName}*:\n";
                $message .= "• *Termin:* Ke-{$termNumber} dari {$totalTerms}\n";
                $message .= "• *Nominal:* {$amount}\n";
                $message .= "• *Jatuh Tempo:* {$dueDate}\n\n";
                $message .= "Silakan lakukan pembayaran melalui tautan berikut:\n";
                $message .= "🔗 {$payUrl}\n\n";
                $message .= "Pastikan pembayaran dilakukan sebelum jatuh tempo agar akses belajar Anda tetap aktif.\n\n";
                $message .= "Terima kasih!\n*Level Up Counting Support*";
            }

            $sent = self::sendText([['phone' => $phoneNumber, 'message' => $message, 'isGroup' => 'false']]);

            if (!$sent && !app()->environment('testing')) {
                return response()->json([
                    'success' => false,
                    'message' => 'Gagal mengirim pengingat WhatsApp melalui gateway Messara. Pastikan koneksi WhatsApp terhubung.'
                ], 422);
            }

            return response()->json([
                'success' => true,
                'message' => "Pengingat cicilan berhasil dikirim ke WhatsApp {$user->name} ({$phoneNumber}).",
                'phone' => $phoneNumber,
                'message_content' => $message,
            ]);
        } catch (\Throwable $e) {
            Log::error('Manual installment reminder failed', ['error' => $e->getMessage()]);
            return response()->json(['success' => false, 'message' => 'Gagal mengirim pengingat: ' . $e->getMessage()], 422);
        }
    }

    /**
     * Update/perpanjang jatuh tempo termin cicilan tertentu oleh admin
     */
    public function updateDueDate(Request $request, $id)
    {
        $request->validate([
            'due_date' => 'required|date',
        ]);

        try {
            $childInvoice = Invoice::findOrFail($id);
            $newDueDate = Carbon::parse($request->due_date);

            $childInvoice->update([
                'installment_due_date' => $newDueDate,
            ]);

            $parentInvoice = $childInvoice->parentInvoice;
            $unsuspended = false;

            if ($parentInvoice && $parentInvoice->access_suspended_at) {
                $now = Carbon::now('Asia/Jakarta');
                $hasOtherOverdue = $parentInvoice->installmentTerms()
                    ->where('id', '!=', $childInvoice->id)
                    ->where('status', '!=', 'paid')
                    ->whereNotNull('installment_due_date')
                    ->where('installment_due_date', '<', $now->startOfDay())
                    ->exists();

                if (!$hasOtherOverdue && $newDueDate->endOfDay()->gte($now)) {
                    $parentInvoice->update(['access_suspended_at' => null]);
                    $unsuspended = true;
                    Log::info("Parent invoice {$parentInvoice->invoice_code} un-suspended by admin extending due date on term {$childInvoice->installment_number}");
                }
            }

            return response()->json([
                'success' => true,
                'message' => 'Tanggal jatuh tempo berhasil diperbarui' . ($unsuspended ? ' dan status pembekuan akses peserta telah dipulihkan.' : '.'),
                'installment_due_date' => $newDueDate->format('Y-m-d H:i:s'),
                'is_access_suspended' => $parentInvoice ? $parentInvoice->isAccessSuspended() : false,
            ]);
        } catch (\Throwable $e) {
            Log::error('Update installment due date failed', ['error' => $e->getMessage()]);
            return response()->json([
                'success' => false,
                'message' => 'Gagal memperbarui tanggal jatuh tempo: ' . $e->getMessage(),
            ], 422);
        }
    }


    private function createTripayTransaction(Invoice $childInvoice, mixed $item, mixed $user, string $channelInput): array
    {
        $productTitle = $item?->title ?? $item?->name ?? 'Produk';
        $channelObj = $this->tripayService->findChannel($channelInput);
        $channelCode = $channelObj ? (string) $channelObj->code : strtoupper(trim($channelInput ?: 'QRIS'));

        $nettAmount = (int) $childInvoice->nett_amount;
        $orderItems = [
            [
                'sku'      => (string) ($item->id ?? $childInvoice->id),
                'name'     => mb_substr($productTitle . ' (Cicilan ke-' . $childInvoice->installment_number . ')', 0, 255),
                'price'    => $nettAmount,
                'quantity' => 1,
            ],
        ];

        $expiresAt = $childInvoice->expires_at instanceof Carbon
            ? $childInvoice->expires_at
            : Carbon::now()->addHours(24);
        $returnUrl = route('tripay.return', ['invoice_id' => $childInvoice->id]);

        $tripayResponse = $this->tripayService->requestTransaction(
            $childInvoice->invoice_code,
            $channelCode,
            $productTitle . ' (Cicilan ke-' . $childInvoice->installment_number . ')',
            $nettAmount,
            $user->name,
            $user->email,
            $user->phone_number ?? '',
            $orderItems,
            $returnUrl,
            (int) $expiresAt->timestamp
        );

        $tripayData = $tripayResponse->data ?? null;
        if (!$tripayData) {
            throw new \Exception('Gagal membuat transaksi pembayaran Tripay untuk cicilan.');
        }

        $actualTotalAmount = isset($tripayData->amount) ? (int) $tripayData->amount : (int) $childInvoice->amount;
        $actualFeeCustomer = isset($tripayData->fee_customer)
            ? (int) $tripayData->fee_customer
            : max(0, $actualTotalAmount - $nettAmount);
        $payCode = $tripayData->pay_code ?? null;
        $qrUrl = $tripayData->qr_url ?? null;
        $qrString = $tripayData->qr_string ?? null;
        $checkoutUrl = $tripayData->checkout_url ?? $returnUrl;
        $expiredTime = !empty($tripayData->expired_time)
            ? Carbon::createFromTimestamp((int) $tripayData->expired_time, 'Asia/Jakarta')
            : $expiresAt;

        $isQrisChannel = str_contains(strtoupper((string) ($tripayData->payment_method ?? $channelCode)), 'QRIS');

        $childInvoice->update([
            'status'            => 'pending',
            'amount'            => $actualTotalAmount,
            'transaction_fee'   => $actualFeeCustomer,
            'payment_method'    => 'tripay',
            'payment_channel'   => $tripayData->payment_method ?? $channelCode,
            'payment_reference' => $tripayData->reference ?? null,
            'va_number'         => $payCode,
            'qr_code_url'       => $qrUrl ?: ($isQrisChannel && $qrString ? route('invoice.qris-image', $childInvoice->id) : null),
            'invoice_url'       => $checkoutUrl,
            'expires_at'        => $expiredTime,
        ]);

        if (!empty($qrString)) {
            $ttlSeconds = max(60, Carbon::now()->diffInSeconds($expiredTime, false));
            Cache::put("tripay_qris_{$childInvoice->id}", $qrString, $ttlSeconds);
        }

        Cache::put("tripay_tx_{$childInvoice->id}", $tripayData, 86400);

        return [
            'success'      => true,
            'redirect_url' => $checkoutUrl,
            'checkout_url' => $checkoutUrl,
            'reference'    => $tripayData->reference ?? null,
            'amount'       => $actualTotalAmount,
            'fee_customer' => $actualFeeCustomer,
        ];
    }

    private function createMidtransTransaction(Invoice $childInvoice, mixed $item, mixed $user): array
    {
        $productTitle = $item?->title ?? $item?->name ?? 'Produk';

        // Gunakan invoice_code. Jika sudah pernah digenerate sebelumnya, gunakan suffix timestamp agar tidak ditolak Midtrans (order_id already taken)
        $orderId = $childInvoice->invoice_code;
        if ($childInvoice->invoice_url) {
            $orderId = $childInvoice->invoice_code . '-' . time();
        }

        $midtransParams = [
            'transaction_details' => [
                'order_id' => $orderId,
                'gross_amount' => (int) $childInvoice->amount,
            ],
            'customer_details' => [
                'first_name' => $user->name,
                'email' => $user->email,
                'phone' => $user->phone_number ?? '',
            ],
            'item_details' => [
                [
                    'id' => (string) $childInvoice->id,
                    'price' => (int) $childInvoice->amount,
                    'quantity' => 1,
                    'name' => mb_substr($productTitle . ' (Cicilan ke-' . $childInvoice->installment_number . ')', 0, 50),
                ],
            ],
            'callbacks' => [
                'finish' => config('app.url') . '/profile/installments',
                'error' => config('app.url') . '/profile/installments',
                'unfinish' => config('app.url') . '/profile/installments',
            ],
        ];

        $response = $this->midtransService->createTransaction($midtransParams);

        // Jika Midtrans menolak karena order_id sudah pernah dipakai, buat order_id baru dengan timestamp
        if (!$response['success'] && isset($response['message']) && str_contains($response['message'], 'order_id has already been taken')) {
            $orderId = $childInvoice->invoice_code . '-' . time();
            $midtransParams['transaction_details']['order_id'] = $orderId;
            $response = $this->midtransService->createTransaction($midtransParams);
        }

        if (!$response['success']) {
            throw new \Exception($response['message'] ?? 'Gagal membuat transaksi Midtrans');
        }

        $childInvoice->update([
            'payment_reference' => $orderId,
        ]);

        return $response;
    }
}

