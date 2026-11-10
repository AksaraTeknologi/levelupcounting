<?php

namespace App\Contracts;

use App\Models\Invoice;
use Illuminate\Http\Request;

interface PaymentGatewayInterface
{
    /**
     * Create a payment transaction with the gateway.
     *
     * @param Invoice $invoice
     * @param array $customerData [customer_name, customer_email, customer_phone, item_name, item_description, callback_url_cancel]
     * @param array $options [payment_channel, method, etc.]
     * @return array [
     *     'success' => bool,
     *     'payment_url' => string,
     *     'reference' => ?string,
     *     'va_number' => ?string,
     *     'qr_code_url' => ?string,
     *     'payment_method' => ?string,
     *     'payment_channel' => ?string,
     *     'raw' => mixed,
     * ]
     */
    public function createPayment(Invoice $invoice, array $customerData = [], array $options = []): array;

    /**
     * Get active payment channels supported by the gateway.
     *
     * @param bool $forceRefresh
     * @return array
     */
    public function getPaymentChannels(bool $forceRefresh = false): array;

    /**
     * Verify the authenticity of a callback/webhook request.
     *
     * @param Request $request
     * @return bool
     */
    public function verifyCallback(Request $request): bool;

    /**
     * Parse the callback/webhook request into normalized data.
     *
     * @param Request $request
     * @return array [
     *     'is_valid' => bool,
     *     'invoice_code' => string,
     *     'reference' => ?string,
     *     'status' => string, // 'PAID', 'FAILED', 'EXPIRED', 'PENDING'
     *     'amount' => ?float,
     *     'payment_method' => ?string,
     *     'payment_channel' => ?string,
     *     'va_number' => ?string,
     *     'qr_code_url' => ?string,
     *     'raw' => mixed,
     * ]
     */
    public function parseCallback(Request $request): array;

    /**
     * Cancel an active payment on the gateway if supported.
     *
     * @param Invoice $invoice
     * @return bool
     */
    public function cancelPayment(Invoice $invoice): bool;

    /**
     * Calculate transaction fee using the gateway fee calculator.
     *
     * @param int $amount
     * @param string|null $channel
     * @return array
     */
    public function calculateFee(int $amount, ?string $channel = null): array;
}

