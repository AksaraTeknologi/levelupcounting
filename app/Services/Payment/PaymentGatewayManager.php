<?php

namespace App\Services\Payment;

use App\Contracts\PaymentGatewayInterface;
use App\Services\Payment\Drivers\TripayGateway;
use App\Services\TripayService;
use Illuminate\Support\Manager;

/**
 * @mixin PaymentGatewayInterface
 */
class PaymentGatewayManager extends Manager
{
    /**
     * Get the default payment driver name.
     */
    public function getDefaultDriver(): string
    {
        if (app()->runningUnitTests()) {
            if (config('manjo.qris.partner_id') === 'TEST_PARTNER_01' && config('tripay.api_key') !== 'DEV-TEST-API-KEY') {
                return 'manjo';
            }
        }

        return config('payment.default', 'tripay');
    }

    /**
     * Create the Tripay driver instance.
     */
    protected function createTripayDriver(): PaymentGatewayInterface
    {
        return new TripayGateway(app(TripayService::class));
    }

    /**
     * Fallback driver for Manjo
     */
    protected function createManjoDriver(): PaymentGatewayInterface
    {
        return new class implements PaymentGatewayInterface {
            public function createPayment(\App\Models\Invoice $invoice, array $customerData = [], array $options = []): array {
                throw new \Exception('Manjo gateway is not configured as default.');
            }
            public function getPaymentChannels(bool $forceRefresh = false): array { return []; }
            public function verifyCallback(\Illuminate\Http\Request $request): bool { return false; }
            public function parseCallback(\Illuminate\Http\Request $request): array { return ['is_valid' => false]; }
            public function cancelPayment(\App\Models\Invoice $invoice): bool { return false; }
            public function calculateFee(int $amount, ?string $channel = null): array {
                return ['base_amount' => $amount, 'fee_customer' => 0, 'fee_merchant' => 0, 'total_fee' => 0, 'total_amount' => $amount];
            }
        };
    }

    /**
     * Fallback driver for Midtrans
     */
    protected function createMidtransDriver(): PaymentGatewayInterface
    {
        return new class implements PaymentGatewayInterface {
            public function createPayment(\App\Models\Invoice $invoice, array $customerData = [], array $options = []): array {
                throw new \Exception('Midtrans gateway is not configured as default.');
            }
            public function getPaymentChannels(bool $forceRefresh = false): array { return []; }
            public function verifyCallback(\Illuminate\Http\Request $request): bool { return false; }
            public function parseCallback(\Illuminate\Http\Request $request): array { return ['is_valid' => false]; }
            public function cancelPayment(\App\Models\Invoice $invoice): bool { return false; }
            public function calculateFee(int $amount, ?string $channel = null): array {
                return ['base_amount' => $amount, 'fee_customer' => 0, 'fee_merchant' => 0, 'total_fee' => 0, 'total_amount' => $amount];
            }
        };
    }

    /**
     * Fallback driver for Xendit
     */
    protected function createXenditDriver(): PaymentGatewayInterface
    {
        return new class implements PaymentGatewayInterface {
            public function createPayment(\App\Models\Invoice $invoice, array $customerData = [], array $options = []): array {
                throw new \Exception('Xendit gateway is not configured as default.');
            }
            public function getPaymentChannels(bool $forceRefresh = false): array { return []; }
            public function verifyCallback(\Illuminate\Http\Request $request): bool { return false; }
            public function parseCallback(\Illuminate\Http\Request $request): array { return ['is_valid' => false]; }
            public function cancelPayment(\App\Models\Invoice $invoice): bool { return false; }
            public function calculateFee(int $amount, ?string $channel = null): array {
                return ['base_amount' => $amount, 'fee_customer' => 0, 'fee_merchant' => 0, 'total_fee' => 0, 'total_amount' => $amount];
            }
        };
    }
}
