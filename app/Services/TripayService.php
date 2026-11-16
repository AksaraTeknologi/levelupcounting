<?php

namespace App\Services;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class TripayService
{
    private string $apiKey;
    private string $merchantCode;
    private string $privateKey;
    private string $baseUrl;
    private bool $isSandbox;

    public function __construct()
    {
        $this->apiKey = (string) (config('tripay.api_key') ?? config('tripay.API_KEY', ''));
        $this->merchantCode = (string) (config('tripay.merchant_code') ?? config('tripay.MERCHANT_CODE', ''));
        $this->privateKey = (string) (config('tripay.private_key') ?? config('tripay.PRIVATE_KEY', ''));
        $this->isSandbox = (bool) (config('tripay.sandbox', true));
        $this->baseUrl = rtrim(
            (string) config('tripay.api_url', $this->isSandbox ? 'https://tripay.co.id/api-sandbox' : 'https://tripay.co.id/api'),
            '/'
        );
    }

    /**
     * Generate HMAC-SHA256 signature for creating transactions.
     */
    public function generateSignature(string $merchantRef, int $amount): string
    {
        return hash_hmac('sha256', $this->merchantCode . $merchantRef . $amount, $this->privateKey);
    }

    /**
     * Verify incoming webhook callback signature from Tripay.
     */
    public function verifyCallbackSignature(Request $request): bool
    {
        $headerSignature = $request->header('X-Callback-Signature')
            ?? $request->server('HTTP_X_CALLBACK_SIGNATURE');

        if (empty($headerSignature) || empty($this->privateKey)) {
            return false;
        }

        $rawPayload = $request->getContent();
        $expectedSignature = hash_hmac('sha256', $rawPayload, $this->privateKey);

        return hash_equals($expectedSignature, (string) $headerSignature);
    }

    /**
     * Get list of active payment channels with caching.
     *
     * @param bool $forceRefresh
     * @return array
     */
    public function getPaymentChannels(bool $forceRefresh = false): array
    {
        $cacheKey = 'tripay_payment_channels_' . ($this->isSandbox ? 'sandbox' : 'prod');

        if (!$forceRefresh) {
            try {
                if (Cache::has($cacheKey)) {
                    $cached = Cache::get($cacheKey);
                    if (is_array($cached) && !empty($cached)) {
                        return $cached;
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('Tripay channel cache read failed: ' . $e->getMessage());
            }
        }

        try {
            $response = Http::withToken($this->apiKey)
                ->timeout(15)
                ->acceptJson()
                ->get($this->baseUrl . '/merchant/payment-channel');

            if (!$response->successful()) {
                Log::error('Tripay payment channels fetch failed', [
                    'status' => $response->status(),
                    'body' => $response->json() ?? $response->body(),
                ]);
                return $this->getDefaultFallbackChannels();
            }

            $body = $response->json();
            $rawChannels = $body['data'] ?? [];

            if (empty($rawChannels)) {
                return $this->getDefaultFallbackChannels();
            }

            $channels = json_decode(json_encode($rawChannels));

            // Cache channels for 60 seconds
            try {
                Cache::put($cacheKey, $channels, 60);
            } catch (\Throwable $e) {
                Log::warning('Tripay channel cache write failed: ' . $e->getMessage());
            }

            return $channels;
        } catch (\Throwable $e) {
            Log::error('Tripay payment channel exception: ' . $e->getMessage());

            // If refresh failed but cache exists, return stale cache
            try {
                if (Cache::has($cacheKey)) {
                    return Cache::get($cacheKey);
                }
            } catch (\Throwable $ignored) {}

            return $this->getDefaultFallbackChannels();
        }
    }

    /**
     * Get default payment channels fallback when API is unreachable or returns error.
     */
    public function getDefaultFallbackChannels(): array
    {
        $raw = [
            [
                'group' => 'Virtual Account',
                'code' => 'BNIVA',
                'name' => 'BNI Virtual Account',
                'type' => 'direct',
                'icon_url' => 'https://assets.tripay.co.id/upload/payment-icon/n22Qsh8jMa1583433577.png',
                'active' => true,
            ],
            [
                'group' => 'Virtual Account',
                'code' => 'BRIVA',
                'name' => 'BRI Virtual Account',
                'type' => 'direct',
                'icon_url' => 'https://assets.tripay.co.id/upload/payment-icon/8WQ3APST5s1579461828.png',
                'active' => true,
            ],
            [
                'group' => 'Virtual Account',
                'code' => 'MANDIRIVA',
                'name' => 'Mandiri Virtual Account',
                'type' => 'direct',
                'icon_url' => 'https://assets.tripay.co.id/upload/payment-icon/T9Z012UE331583531536.png',
                'active' => true,
            ],
            [
                'group' => 'Virtual Account',
                'code' => 'BCAVA',
                'name' => 'BCA Virtual Account',
                'type' => 'direct',
                'icon_url' => 'https://assets.tripay.co.id/upload/payment-icon/ytBKvaleGy1605201833.png',
                'active' => true,
            ],
            [
                'group' => 'Virtual Account',
                'code' => 'BSIVA',
                'name' => 'BSI Virtual Account',
                'type' => 'direct',
                'icon_url' => 'https://upload.wikimedia.org/wikipedia/commons/a/a0/Bank_Syariah_Indonesia.svg',
                'active' => true,
            ],
            [
                'group' => 'Convenience Store',
                'code' => 'ALFAMART',
                'name' => 'Alfamart',
                'type' => 'direct',
                'icon_url' => 'https://upload.wikimedia.org/wikipedia/commons/8/86/Alfamart_logo.svg',
                'active' => true,
            ],
            [
                'group' => 'Convenience Store',
                'code' => 'INDOMARET',
                'name' => 'Indomaret',
                'type' => 'direct',
                'icon_url' => 'https://assets.tripay.co.id/upload/payment-icon/zNzuO5AuLw1583513974.png',
                'active' => true,
            ],
            [
                'group' => 'QRIS',
                'code' => 'QRIS',
                'name' => 'QRIS',
                'type' => 'direct',
                'icon_url' => 'https://assets.tripay.co.id/upload/payment-icon/BpE4BPVyIw1605597490.png',
                'active' => true,
            ],
        ];

        return json_decode(json_encode($raw));
    }

    /**
     * Resolve channel object from Tripay channel list by code or alias.
     */
    public function findChannel(string $channelCode, ?array $channels = null): ?object
    {
        $channels = $channels ?? $this->getPaymentChannels();
        $upper = strtoupper(trim($channelCode));

        $aliasMap = [
            'BMRI' => 'MANDIRIVA',
            'MANDIRI' => 'MANDIRIVA',
            'BRIN' => 'BRIVA',
            'BRI' => 'BRIVA',
            'BNIA' => 'CIMBVA',
            'CIMB' => 'CIMBVA',
            'CIMB_NIAGA' => 'CIMBVA',
            'BBBA' => 'PERMATAVA',
            'PERMATA' => 'PERMATAVA',
            'BSYI' => 'BSIVA',
            'BSI' => 'BSIVA',
            'BCA' => 'BCAVA',
            'BNI' => 'BNIVA',
        ];

        $mappedCode = $aliasMap[$upper] ?? $upper;

        foreach ($channels as $ch) {
            $chObj = is_array($ch) ? (object) $ch : $ch;
            $code = strtoupper((string) ($chObj->code ?? ''));
            if ($code === $upper || $code === $mappedCode) {
                return $chObj;
            }
        }

        if ($upper === 'QRIS') {
            foreach ($channels as $ch) {
                $chObj = is_array($ch) ? (object) $ch : $ch;
                $code = strtoupper((string) ($chObj->code ?? ''));
                if (str_starts_with($code, 'QRIS')) {
                    return $chObj;
                }
            }
        }

        return null;
    }

    /**
     * Calculate customer fee based on Tripay channel fee_customer structure
     * (flat, percent, minimum_fee, maximum_fee).
     */
    public function calculateCustomerFee($channel, float|int $nettAmount): int
    {
        if ($nettAmount <= 0 || !$channel) {
            return 0;
        }

        $chObj = is_array($channel) ? (object) $channel : $channel;
        $feeCustomer = $chObj->fee_customer ?? null;
        if (!$feeCustomer) {
            return 0;
        }

        $feeObj = is_array($feeCustomer) ? (object) $feeCustomer : $feeCustomer;
        $flat = (float) ($feeObj->flat ?? 0);
        $percent = (float) ($feeObj->percent ?? 0);

        if ($flat <= 0 && $percent <= 0) {
            return 0;
        }

        $calculated = $flat + ($nettAmount * ($percent / 100));

        $minFee = isset($chObj->minimum_fee) && $chObj->minimum_fee !== null ? (float) $chObj->minimum_fee : null;
        $maxFee = isset($chObj->maximum_fee) && $chObj->maximum_fee !== null ? (float) $chObj->maximum_fee : null;

        if ($minFee !== null && $minFee > 0 && $calculated < $minFee) {
            $calculated = $minFee;
        }

        if ($maxFee !== null && $maxFee > 0 && $calculated > $maxFee) {
            $calculated = $maxFee;
        }

        return (int) round($calculated);
    }

    /**
     * Create closed payment transaction on Tripay.
     *
     * @param string $merchantRef
     * @param string $method
     * @param string $title
     * @param int|float $amount
     * @param string $customerName
     * @param string $customerEmail
     * @param string|null $customerPhone
     * @param array $orderItems
     * @param string|null $returnUrl
     * @param int|null $expiredTime
     * @return object
     * @throws \Exception
     */
    public function requestTransaction(
        $merchantRef,
        $method,
        $title,
        $amount,
        $customerName,
        $customerEmail,
        ?string $customerPhone = null,
        $orderItems = [],
        ?string $returnUrl = null,
        $expiredTime = null
    ) {
        // Support legacy parameter order where $returnUrl was passed at position 8
        if (is_string($orderItems)) {
            $expiredTime = $returnUrl;
            $returnUrl = $orderItems;
            $orderItems = [];
        }
        $amount = (int) round($amount);
        if ($amount <= 0) {
            throw new \Exception('Transaction amount must be greater than 0');
        }

        if (empty($method)) {
            throw new \Exception('Payment method is required by Tripay');
        }

        $signature = $this->generateSignature($merchantRef, $amount);

        // Normalize phone number (digits only, e.g. 08123... or 628123...)
        $formattedPhone = null;
        if (!empty($customerPhone)) {
            $formattedPhone = preg_replace('/[^0-9]/', '', $customerPhone);
            if (str_starts_with($formattedPhone, '62')) {
                $formattedPhone = '0' . substr($formattedPhone, 2);
            }
        }

        // Build order items
        if (empty($orderItems)) {
            $orderItems = [
                [
                    'sku' => 'LUC-' . $merchantRef,
                    'name' => substr($title, 0, 255),
                    'price' => $amount,
                    'quantity' => 1,
                ],
            ];
        }

        $resolvedExpiredTime = $expiredTime instanceof \DateTimeInterface
            ? $expiredTime->getTimestamp()
            : (is_numeric($expiredTime) && (int) $expiredTime > 0 ? (int) $expiredTime : (time() + (24 * 60 * 60)));

        $payload = [
            'method' => strtoupper($method),
            'merchant_ref' => $merchantRef,
            'amount' => $amount,
            'customer_name' => $customerName ?: 'Customer',
            'customer_email' => $customerEmail ?: 'customer@example.com',
            'customer_phone' => $formattedPhone ?: '081234567890',
            'order_items' => $orderItems,
            'callback_url' => route('tripay.callback'),
            'return_url' => $returnUrl ?: (route('tripay.return', ['merchant_ref' => $merchantRef])),
            'expired_time' => $resolvedExpiredTime,
            'signature' => $signature,
        ];

        try {
            $response = Http::withToken($this->apiKey)
                ->timeout(20)
                ->acceptJson()
                ->asJson()
                ->post($this->baseUrl . '/transaction/create', $payload);

            $responseBody = $response->json();

            if (!$response->successful() || empty($responseBody['success'])) {
                $errorMessage = $responseBody['message'] ?? ('Tripay HTTP ' . $response->status());
                Log::error('Tripay transaction create error', [
                    'merchant_ref' => $merchantRef,
                    'method' => $method,
                    'status' => $response->status(),
                    'message' => $errorMessage,
                ]);
                throw new \Exception('Tripay Error: ' . $errorMessage);
            }

            if (!isset($responseBody['data'])) {
                throw new \Exception('Invalid response structure from Tripay');
            }

            // Return as object for backward compatibility
            return json_decode(json_encode($responseBody));
        } catch (\Throwable $e) {
            Log::error('Tripay requestTransaction exception', [
                'merchant_ref' => $merchantRef,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
    }

    /**
     * Get transaction detail from Tripay by reference code.
     *
     * @param string $reference
     * @return object
     * @throws \Exception
     */
    public function detailTransaction($reference)
    {
        try {
            $response = Http::withToken($this->apiKey)
                ->timeout(15)
                ->acceptJson()
                ->get($this->baseUrl . '/transaction/detail', [
                    'reference' => $reference,
                ]);

            if (!$response->successful()) {
                throw new \Exception('Failed to get Tripay transaction detail (HTTP ' . $response->status() . ')');
            }

            $body = $response->json();
            if (!isset($body['data'])) {
                throw new \Exception('Tripay transaction detail not found');
            }

            return json_decode(json_encode($body));
        } catch (\Throwable $e) {
            Log::error('Tripay detailTransaction error: ' . $e->getMessage(), [
                'reference' => $reference,
            ]);
            throw $e;
        }
    }

    public function getApiKey(): string
    {
        return $this->apiKey;
    }

    public function getMerchantCode(): string
    {
        return $this->merchantCode;
    }

    public function getBaseUrl(): string
    {
        return $this->baseUrl;
    }

    public function isSandbox(): bool
    {
        return $this->isSandbox;
    }

    /**
     * Calculate transaction fee using Tripay Fee Calculator API.
     *
     * @param int $amount
     * @param string|null $code
     * @return array
     * @throws \Exception
     */
    public function calculateFee(int $amount, ?string $code = null): array
    {
        if ($amount <= 0) {
            throw new \InvalidArgumentException('Nominal transaksi harus lebih besar dari 0.');
        }

        $params = ['amount' => $amount];
        if (!empty($code)) {
            $params['code'] = strtoupper(trim($code));
        }

        try {
            $response = Http::withToken($this->apiKey)
                ->timeout(15)
                ->acceptJson()
                ->get($this->baseUrl . '/merchant/fee-calculator', $params);

            $responseBody = $response->json();

            if (!$response->successful() || empty($responseBody['success'])) {
                $errorMsg = $responseBody['message'] ?? ('HTTP ' . $response->status());
                Log::error('Tripay fee calculator error', [
                    'amount' => $amount,
                    'code' => $code,
                    'status' => $response->status(),
                    'error' => $errorMsg,
                ]);
                throw new \Exception('Gagal menghitung biaya pembayaran: ' . $errorMsg);
            }

            $data = $responseBody['data'] ?? [];
            if (empty($data)) {
                throw new \Exception('Data perhitungan biaya tidak ditemukan dari Tripay.');
            }

            // If a specific code was requested, return that channel's calculation
            if (!empty($code)) {
                $targetCode = strtoupper(trim($code));
                $selected = null;
                foreach ($data as $item) {
                    if (strtoupper($item['code'] ?? '') === $targetCode) {
                        $selected = $item;
                        break;
                    }
                }
                if (!$selected) {
                    $selected = $data[0] ?? null;
                }
                if (!$selected) {
                    throw new \Exception('Channel pembayaran ' . $code . ' tidak ditemukan pada Tripay.');
                }

                return $this->formatFeeResponse($selected, $amount);
            }

            // Return all channels formatted
            return array_map(function ($item) use ($amount) {
                return $this->formatFeeResponse($item, $amount);
            }, $data);
        } catch (\Throwable $e) {
            Log::error('Tripay calculateFee exception', [
                'amount' => $amount,
                'code' => $code,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
    }

    /**
     * Format a single Fee Calculator item into a normalized structure.
     */
    private function formatFeeResponse(array $item, int $baseAmount): array
    {
        $feeCustomer = (int) ($item['total_fee']['customer'] ?? 0);
        $feeMerchant = (int) ($item['total_fee']['merchant'] ?? 0);
        $totalFee = $feeCustomer + $feeMerchant;

        return [
            'code' => $item['code'] ?? '',
            'name' => $item['name'] ?? '',
            'base_amount' => $baseAmount,
            'fee_customer' => $feeCustomer,
            'fee_merchant' => $feeMerchant,
            'total_fee' => $totalFee,
            'total_amount' => $baseAmount + $feeCustomer,
            'minimum_fee' => $item['fee']['min'] ?? null,
            'maximum_fee' => $item['fee']['max'] ?? null,
            'fee_formula' => [
                'flat' => (int) ($item['fee']['flat'] ?? 0),
                'percent' => (float) ($item['fee']['percent'] ?? 0),
            ],
            'raw' => $item,
        ];
    }
}
