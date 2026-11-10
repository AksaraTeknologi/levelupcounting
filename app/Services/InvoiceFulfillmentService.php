<?php

namespace App\Services;

use App\Models\Invoice;
use Illuminate\Support\Facades\Log;

class InvoiceFulfillmentService
{
    /**
     * Standard relations needed for invoice fulfillment.
     */
    public const INVOICE_RELATIONS = [
        'user',
        'courseItems.course.user',
        'bootcampItems.bootcamp',
        'webinarItems.webinar',
        'certificationProgramItems.certificationProgram',
        'bundleEnrollments.bundle.bundleItems.bundleable',
    ];

    protected PaymentSettlementService $settlementService;

    public function __construct(PaymentSettlementService $settlementService)
    {
        $this->settlementService = $settlementService;
    }

    /**
     * Execute the full fulfillment workflow for an invoice.
     *
     * @param Invoice $invoice
     * @param string $status 'PAID', 'FAILED', 'EXPIRED', 'REFUND'
     * @param string|null $paymentMethod
     * @param string|null $paymentChannel
     * @param string|null $paymentReference
     * @param array $extraData
     * @return array
     */
    public function fulfill(
        Invoice $invoice,
        string $status,
        ?string $paymentMethod = null,
        ?string $paymentChannel = null,
        ?string $paymentReference = null,
        array $extraData = []
    ): array {
        $invoice->loadMissing(self::INVOICE_RELATIONS);
        $upperStatus = strtoupper(trim($status));

        // 1. REFUND can occur on invoices that are already paid
        if (in_array($upperStatus, ['REFUND', 'REFUNDED'], true)) {
            $success = $this->settlementService->refund($invoice, $extraData);
            return [
                'success' => $success,
                'invoice' => $invoice->fresh(),
            ];
        }

        // 2. Idempotency: If the invoice is already processed and not pending
        if ($invoice->status !== 'pending') {
            Log::info('Invoice already processed or not pending', [
                'invoice_code' => $invoice->invoice_code,
                'current_status' => $invoice->status,
                'incoming_status' => $status,
            ]);

            return [
                'success' => true,
                'already_processed' => true,
                'invoice' => $invoice,
            ];
        }

        if (in_array($upperStatus, ['PAID', 'SETTLEMENT', 'SUCCESS'], true)) {
            $settleData = array_merge($extraData, [
                'payment_method' => $paymentMethod,
                'payment_channel' => $paymentChannel,
                'payment_reference' => $paymentReference,
            ]);

            if (isset($extraData['total_amount'])) {
                $settleData['amount'] = $extraData['total_amount'];
            }

            $success = $this->settlementService->settle($invoice, $settleData);

            return [
                'success' => $success,
                'invoice' => $invoice->fresh(),
            ];
        }

        if (in_array($upperStatus, ['EXPIRED'], true)) {
            $success = $this->settlementService->fail($invoice, 'Payment expired', 'EXPIRED');
            return [
                'success' => $success,
                'invoice' => $invoice->fresh(),
            ];
        }

        // Default failure (FAILED, etc.)
        $success = $this->settlementService->fail($invoice, 'failed', $upperStatus);
        return [
            'success' => $success,
            'invoice' => $invoice->fresh(),
        ];
    }
}
