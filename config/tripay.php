<?php

$isSandbox = (bool) env('TRIPAY_SANDBOX', true);

return [
    // Uppercase for backward compatibility
    'API_KEY' => env('TRIPAY_API_KEY'),
    'PRIVATE_KEY' => env('TRIPAY_PRIVATE_KEY'),
    'MERCHANT_CODE' => env('TRIPAY_MERCHANT_CODE'),

    // Modern standard keys
    'active_gateway' => env('PAYMENT_GATEWAY', 'tripay'),
    'api_key' => env('TRIPAY_API_KEY'),
    'private_key' => env('TRIPAY_PRIVATE_KEY'),
    'merchant_code' => env('TRIPAY_MERCHANT_CODE'),
    'sandbox' => $isSandbox,
    'api_url' => env(
        'TRIPAY_API_URL',
        $isSandbox ? 'https://tripay.co.id/api-sandbox' : 'https://tripay.co.id/api'
    ),
];
