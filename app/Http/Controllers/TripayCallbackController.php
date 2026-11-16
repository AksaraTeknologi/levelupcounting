<?php

namespace App\Http\Controllers;

use App\Models\Invoice;
use App\Services\InvoiceFulfillmentService;
use App\Services\TripayService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class TripayCallbackController extends Controller
{
    protected TripayService $tripayService;
    protected InvoiceFulfillmentService $fulfillmentService;

    public function __construct(
        TripayService $tripayService,
        InvoiceFulfillmentService $fulfillmentService
    ) {
        $this->tripayService = $tripayService;
        $this->fulfillmentService = $fulfillmentService;
    }

    /**
     * Handle incoming Tripay webhook callback.
     *
     * @param Request $request
     * @return JsonResponse
     */
    public function handle(Request $request): JsonResponse
    {
        Log::info('=== TRIPAY CALLBACK RECEIVED ===', [
            'headers' => [
                'X-Callback-Event' => $request->header('X-Callback-Event') ?? $request->server('HTTP_X_CALLBACK_EVENT'),
                'X-Callback-Signature' => $request->header('X-Callback-Signature') ? 'PRESENT' : 'MISSING',
            ],
            'payload' => $request->all(),
        ]);

        // 1. Signature Verification
        if (!$this->tripayService->verifyCallbackSignature($request)) {
            Log::warning('Tripay callback invalid signature');
            return response()->json([
                'success' => false,
                'message' => 'Invalid signature',
            ], 401);
        }

        // 2. Verify Event Type
        $event = $request->header('X-Callback-Event') ?? $request->server('HTTP_X_CALLBACK_EVENT');
        if ($event !== 'payment_status') {
            Log::info('Tripay callback ignored event: ' . $event);
            return response()->json([
                'success' => false,
                'message' => 'Unrecognized callback event',
            ], 200);
        }

        // 3. Parse JSON Body
        $json = $request->getContent();
        $data = json_decode($json);

        if (json_last_error() !== JSON_ERROR_NONE || !is_object($data)) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid JSON payload',
            ], 400);
        }

        $merchantRef = (string) ($data->merchant_ref ?? '');
        $tripayReference = (string) ($data->reference ?? '');
        $status = strtoupper((string) ($data->status ?? ''));

        if (empty($merchantRef) && empty($tripayReference)) {
            return response()->json([
                'success' => false,
                'message' => 'Missing merchant_ref or reference',
            ], 400);
        }

        if (empty($tripayReference) || empty($status)) {
            return response()->json([
                'success' => false,
                'message' => 'Missing required fields',
            ], 400);
        }

        if (isset($data->is_closed_payment) && (int) $data->is_closed_payment !== 1) {
            return response()->json([
                'success' => false,
                'message' => 'Not a closed payment',
            ], 400);
        }

        // 4. Lookup Invoice (supporting timestamps on invoice_code, e.g. term payments: CODE_timestamp)
        $baseCode = explode('_', $merchantRef)[0];

        $invoice = Invoice::with(InvoiceFulfillmentService::INVOICE_RELATIONS)
            ->where(function ($query) use ($merchantRef, $baseCode, $tripayReference) {
                if (!empty($merchantRef)) {
                    $query->where('invoice_code', $merchantRef)
                        ->orWhere('invoice_code', $baseCode);
                }
                if (!empty($tripayReference)) {
                    $query->orWhere('payment_reference', $tripayReference);
                }
            })
            ->first();

        if (!$invoice) {
            Log::warning('Tripay callback: invoice not found', [
                'merchant_ref' => $merchantRef,
                'reference' => $tripayReference,
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Invoice not found',
            ], 404);
        }

        // 5. Merchant reference mismatch check if invoice found via reference
        if (!empty($merchantRef) && !empty($invoice->invoice_code)) {
            $invoiceBase = explode('_', $invoice->invoice_code)[0];
            if ($invoice->invoice_code !== $merchantRef && $invoiceBase !== $baseCode) {
                Log::warning('Tripay callback: merchant_ref mismatch', [
                    'expected_invoice_code' => $invoice->invoice_code,
                    'received_merchant_ref' => $merchantRef,
                    'reference' => $tripayReference,
                ]);

                return response()->json([
                    'success' => false,
                    'message' => 'Invalid merchant reference',
                ], 422);
            }
        }

        // 6. Idempotency Check: if already processed, return 200 to satisfy Tripay retry policy (except refunds)
        if ($invoice->status !== 'pending' && !in_array($status, ['REFUND', 'REFUNDED'], true)) {
            Log::info('Tripay callback: invoice already processed', [
                'invoice_code' => $invoice->invoice_code,
                'current_status' => $invoice->status,
                'incoming_status' => $status,
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Invoice already processed',
            ], 200);
        }

        // 7. Transaction Amount Verification against stored snapshot
        $incomingAmount = (int) ($data->total_amount ?? 0);
        if ($incomingAmount > 0 && (int) $invoice->amount !== $incomingAmount) {
            Log::warning('Tripay callback amount mismatch', [
                'invoice_code' => $invoice->invoice_code,
                'expected' => (int) $invoice->amount,
                'received' => $incomingAmount,
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Invalid payment amount',
            ], 422);
        }

        // 8. Execute Shared Fulfillment
        try {
            $paymentMethod = $data->payment_method ?? ($data->payment_name ?? 'TRIPAY');
            $paymentChannel = $data->payment_method_code ?? ($data->payment_method ?? ($data->payment_name ?? 'TRIPAY'));

            $this->fulfillmentService->fulfill(
                $invoice,
                $status,
                $paymentMethod,
                $paymentChannel,
                $tripayReference,
                [
                    'va_number' => $data->pay_code ?? null,
                    'qr_code_url' => $data->qr_url ?? null,
                    'total_amount' => $data->total_amount ?? null,
                ]
            );

            return response()->json(['success' => true], 200);
        } catch (\Throwable $e) {
            Log::error('Tripay fulfillment error: ' . $e->getMessage(), [
                'trace' => $e->getTraceAsString(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Internal server error while processing fulfillment',
            ], 500);
        }
    }
}
