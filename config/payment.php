<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Default Payment Gateway
    |--------------------------------------------------------------------------
    |
    | Supported: "tripay", "manjo", "midtrans", "xendit"
    |
    */
    'default' => env('PAYMENT_GATEWAY', 'tripay'),

    /*
    |--------------------------------------------------------------------------
    | Payment Gateway Configurations
    |--------------------------------------------------------------------------
    */
    'gateways' => [
        'tripay' => [
            'api_key' => env('TRIPAY_API_KEY'),
            'private_key' => env('TRIPAY_PRIVATE_KEY'),
            'merchant_code' => env('TRIPAY_MERCHANT_CODE'),
            'sandbox' => env('TRIPAY_SANDBOX', true),
        ],

        'manjo' => [
            'merchant_id' => env('MANJO_MERCHANT_ID'),
            'secret_key' => env('MANJO_SECRET_KEY'),
        ],

        'midtrans' => [
            'server_key' => env('MIDTRANS_SERVER_KEY'),
            'client_key' => env('MIDTRANS_CLIENT_KEY'),
            'is_production' => env('MIDTRANS_IS_PRODUCTION', false),
        ],

        'xendit' => [
            'api_key' => env('XENDIT_API_KEY'),
            'callback_token' => env('XENDIT_CALLBACK_TOKEN'),
        ],
    ],
];

