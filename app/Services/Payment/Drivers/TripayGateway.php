<?php

namespace App\Services\Payment\Drivers;

use App\Contracts\PaymentGatewayInterface;
use App\Models\Invoice;
use App\Services\TripayService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class TripayGateway implements PaymentGatewayInterface
{
    protected TripayService $tripayService;

    public function __construct(TripayService $tripayService)
    {
        $this->tripayService = $tripayService;
    }

    public function createPayment(Invoice $invoice, array $customerData = [], array $options = []): array
    {
        $channel = $options['payment_channel']
            ?? $options['method']
            ?? $invoice->payment_channel
            ?? 'QRIS';

        $title = $customerData['item_name']
            ?? $customerData['item_description']
            ?? ('Pembayaran ' . $invoice->invoice_code);

        $customerName = $customerData['customer_name'] ?? $invoice->user?->name ?? 'Customer';
        $customerEmail = $customerData['customer_email'] ?? $invoice->user?->email ?? 'customer@example.com';
        $customerPhone = $customerData['customer_phone'] ?? $invoice->user?->phone_number;

        $returnUrl = $customerData['callback_url'] ?? null;
        if (!$returnUrl) {
            if (\Illuminate\Support\Facades\Route::has('tripay.return')) {
                $returnUrl = route('tripay.return', ['invoice_id' => $invoice->id]);
            } elseif (request() && request()->getHttpHost()) {
                $returnUrl = request()->getSchemeAndHttpHost() . '/tripay/return?invoice_id=' . $invoice->id;
            } else {
                $returnUrl = rtrim(config('app.url'), '/') . '/tripay/return?invoice_id=' . $invoice->id;
            }
        }

        $baseAmount = $options['amount']
            ?? ($invoice->nett_amount > 0 ? (int) $invoice->nett_amount : (int) $invoice->amount);

        $response = $this->tripayService->requestTransaction(
            $invoice->invoice_code,
            $channel,
            $title,
            $baseAmount,
            $customerName,
            $customerEmail,
            $customerPhone,
            $options['order_items'] ?? [],
            $returnUrl,
            $options['expired_time'] ?? null
        );

        $data = $response->data;

        return [
            'success' => true,
            'payment_url' => $data->checkout_url ?? '',
            'reference' => $data->reference ?? null,
            'va_number' => $data->pay_code ?? null,
            'qr_code_url' => $data->qr_url ?? null,
            'payment_method' => 'TRIPAY',
            'payment_channel' => $data->payment_method ?? $channel,
            'amount' => (int) ($data->amount ?? $baseAmount),
            'fee_customer' => (int) ($data->fee_customer ?? 0),
            'fee_merchant' => (int) ($data->fee_merchant ?? 0),
            'total_fee' => (int) ($data->total_fee ?? 0),
            'amount_received' => (int) ($data->amount_received ?? $baseAmount),
            'raw' => $response,
        ];
    }

    public function getPaymentChannels(bool $forceRefresh = false): array
    {
        return $this->tripayService->getPaymentChannels($forceRefresh);
    }

    public function verifyCallback(Request $request): bool
    {
        return $this->tripayService->verifyCallbackSignature($request);
    }

    public function parseCallback(Request $request): array
    {
        $raw = $request->getContent();
        $data = json_decode($raw, true);

        if (!is_array($data)) {
            return [
                'is_valid' => false,
                'status' => 'INVALID',
                'invoice_code' => '',
                'reference' => null,
                'amount' => 0,
                'payment_method' => 'TRIPAY',
                'payment_channel' => null,
                'va_number' => null,
                'qr_code_url' => null,
                'raw' => null,
            ];
        }

        $rawStatus = strtoupper((string) ($data['status'] ?? ''));
        $status = match ($rawStatus) {
            'PAID', 'SETTLEMENT' => 'PAID',
            'EXPIRED' => 'EXPIRED',
            'FAILED', 'FAILED_AFTER_PAID' => 'FAILED',
            default => 'PENDING',
        };

        return [
            'is_valid' => true,
            'invoice_code' => (string) ($data['merchant_ref'] ?? ''),
            'reference' => (string) ($data['reference'] ?? ''),
            'status' => $status,
            'amount' => isset($data['total_amount']) ? (float) $data['total_amount'] : null,
            'payment_method' => 'TRIPAY',
            'payment_channel' => $data['payment_method'] ?? null,
            'va_number' => $data['pay_code'] ?? null,
            'qr_code_url' => $data['qr_url'] ?? null,
            'raw' => $data,
        ];
    }

    public function cancelPayment(Invoice $invoice): bool
    {
        // Tripay closed transactions auto-expire and cannot be canceled via API
        return true;
    }

    public function calculateFee(int $amount, ?string $channel = null): array
    {
        return $this->tripayService->calculateFee($amount, $channel);
    }
}

