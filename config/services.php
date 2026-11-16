<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'token' => env('POSTMARK_TOKEN'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'resend' => [
        'key' => env('RESEND_KEY'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],
    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect' => env('GOOGLE_REDIRECT_URI'),
    ],
    'github' => [
        'client_id' => env('GITHUB_CLIENT_ID'),
        'client_secret' => env('GITHUB_CLIENT_SECRET'),
        'redirect' => env('GITHUB_REDIRECT_URI'),
    ],
    'wablas' => [
        'domain' => env('DOMAIN_SERVER_WABLAS', 'https://sby.wablas.com'),
        'token' => env('SECURITY_TOKEN_WABLAS'),
        'secret' => env('SECRET_KEY_WABLAS'),
    ],
    'messara' => [
        'domain' => env('MESSARA_DOMAIN_SERVER', env('DOMAIN_SERVER_MESSARA', 'https://messara.aksarateknologi.co.id')),
        'api_key' => env('MESSARA_API_KEY', env('API_KEY_MESSARA')),
        'secret_key' => env('MESSARA_SECRET_KEY', env('SECRET_KEY_MESSARA')),
        'use_template' => (bool) env('WA_USE_TEMPLATE', false),
        'invoice_template_name' => env('WA_INVOICE_TEMPLATE_NAME', 'invoice_pembayaran_berhasil'),
        'verify_ssl' => (bool) env('MESSARA_VERIFY_SSL', false),
    ],
    'default_wa_gateway' => env('DEFAULT_WA_GATEWAY', 'messara'),

];
