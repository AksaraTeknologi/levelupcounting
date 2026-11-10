<?php

namespace Tests\Feature\Payment;

use App\Events\TransactionPaid;
use App\Models\AffiliateEarning;
use App\Models\Bundle;
use App\Models\BundleItem;
use App\Models\Category;
use App\Models\Certificate;
use App\Models\CertificateDesign;
use App\Models\CertificateParticipant;
use App\Models\CertificateSign;
use App\Models\CertificationProgram;
use App\Models\Course;
use App\Models\DiscountCode;
use App\Models\DiscountUsage;
use App\Models\EnrollmentBundle;
use App\Models\EnrollmentCourse;
use App\Models\Invoice;
use App\Models\ProductInstallmentTerm;
use App\Models\User;
use App\Services\TripayService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class TripayPaymentGatewayTest extends TestCase
{
    use RefreshDatabase;

    protected User $buyer;
    protected User $affiliate;
    protected Course $course;
    protected Certificate $certificate;
    protected Category $category;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutVite();

        Config::set('tripay.active_gateway', 'tripay');
        Config::set('tripay.api_key', 'DEV-TEST-API-KEY');
        Config::set('tripay.private_key', 'DEV-TEST-PRIVATE-KEY');
        Config::set('tripay.merchant_code', 'T12345');
        Config::set('tripay.api_url', 'https://tripay.co.id/api-sandbox');

        Role::firstOrCreate(['name' => 'admin']);
        Role::firstOrCreate(['name' => 'user']);
        Role::firstOrCreate(['name' => 'affiliate']);
        Role::firstOrCreate(['name' => 'mentor']);

        $this->affiliate = User::factory()->create([
            'name'             => 'Affiliate Partner',
            'email'            => 'affiliate@example.com',
            'affiliate_code'   => 'LUC2025',
            'affiliate_status' => 'Active',
            'commission'       => 10,
        ]);
        $this->affiliate->assignRole('affiliate');

        $this->buyer = User::factory()->create([
            'name'          => 'Budi Santoso',
            'email'         => 'budi@example.com',
            'phone_number'  => '081234567890',
            'instance'      => 'PT Akuntansi Maju',
            'city'          => 'Jakarta',
            'point_balance' => 50000,
        ]);
        $this->buyer->assignRole('user');

        $mentor = User::factory()->create([
            'name'       => 'Mentor Pajak',
            'email'      => 'mentor@example.com',
            'commission' => 15,
        ]);
        $mentor->assignRole('mentor');

        $this->category = Category::firstOrCreate(
            ['slug' => 'tax-accounting'],
            ['name' => 'Tax & Accounting']
        );

        $this->course = Course::create([
            'user_id'             => $mentor->id,
            'category_id'         => $this->category->id,
            'title'               => 'Brevet Pajak A & B Terpadu',
            'slug'                => 'brevet-pajak-a-b-terpadu',
            'short_description'   => 'Kelas Brevet Pajak lengkap',
            'description'         => 'Deskripsi lengkap kelas Brevet Pajak',
            'price'               => 200000,
            'strikethrough_price' => 300000,
            'level'               => 'beginner',
            'status'              => 'published',
            'installment_enabled' => true,
        ]);

        $design = CertificateDesign::create([
            'name'    => 'Default Design',
            'image_1' => 'design1.png',
        ]);

        $sign = CertificateSign::create([
            'name'     => 'Direktur Utama',
            'position' => 'CEO',
        ]);

        $this->certificate = Certificate::create([
            'design_id'          => $design->id,
            'sign_id'            => $sign->id,
            'course_id'          => $this->course->id,
            'certificate_number' => 'CERT-BREVET-001',
            'title'              => 'Sertifikat Brevet Pajak',
            'description'        => 'Sertifikat Kelulusan',
            'header_top'         => 'Sertifikat',
            'header_bottom'      => 'Kelulusan',
            'issued_date'        => now()->toDateString(),
        ]);
    }

    protected function sampleTripayChannels(): array
    {
        return [
            [
                'group'          => 'E-Wallet',
                'code'           => 'QRIS',
                'name'           => 'QRIS (Customizable)',
                'type'           => 'direct',
                'fee_merchant'   => ['flat' => 0, 'percent' => 0],
                'fee_customer'   => ['flat' => 750, 'percent' => 0.70],
                'total_fee'      => ['flat' => 750, 'percent' => '0.70'],
                'minimum_fee'    => 1000,
                'maximum_fee'    => 25000,
                'minimum_amount' => 1000,
                'maximum_amount' => 10000000,
                'icon_url'       => 'https://assets.tripay.co.id/upload/payment-icon/qris.png',
                'active'         => true,
            ],
            [
                'group'          => 'Virtual Account',
                'code'           => 'BRIVA',
                'name'           => 'BRI Virtual Account',
                'type'           => 'direct',
                'fee_merchant'   => ['flat' => 0, 'percent' => 0],
                'fee_customer'   => ['flat' => 4250, 'percent' => 0],
                'total_fee'      => ['flat' => 4250, 'percent' => '0.00'],
                'minimum_fee'    => null,
                'maximum_fee'    => null,
                'minimum_amount' => 10000,
                'maximum_amount' => 50000000,
                'icon_url'       => 'https://assets.tripay.co.id/upload/payment-icon/briva.png',
                'active'         => true,
            ],
            [
                'group'          => 'Virtual Account',
                'code'           => 'MANDIRIVA',
                'name'           => 'Mandiri Virtual Account',
                'type'           => 'direct',
                'fee_merchant'   => ['flat' => 0, 'percent' => 0],
                'fee_customer'   => ['flat' => 4250, 'percent' => 0],
                'total_fee'      => ['flat' => 4250, 'percent' => '0.00'],
                'minimum_fee'    => null,
                'maximum_fee'    => null,
                'minimum_amount' => 10000,
                'maximum_amount' => 50000000,
                'icon_url'       => 'https://assets.tripay.co.id/upload/payment-icon/mandiriva.png',
                'active'         => true,
            ],
        ];
    }

    /**
     * 1. Pengambilan payment channel Tripay & endpoint /payment/va-banks
     */
    public function test_fetch_tripay_payment_channels_and_va_banks_endpoint(): void
    {
        Http::fake([
            '*/merchant/payment-channel*' => Http::response([
                'success' => true,
                'message' => 'Success',
                'data'    => $this->sampleTripayChannels(),
            ], 200),
        ]);

        $tripayService = app(TripayService::class);
        $channels = $tripayService->getPaymentChannels();

        $this->assertCount(3, $channels);
        $this->assertSame('QRIS', $channels[0]->code);
        $this->assertSame('BRIVA', $channels[1]->code);

        $response = $this->getJson('/payment/va-banks');
        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('banks.0.code', 'QRIS')
            ->assertJsonPath('banks.0.fee_customer.flat', 750)
            ->assertJsonPath('banks.1.code', 'BRIVA')
            ->assertJsonPath('banks.1.fee_customer.flat', 4250);
    }

    /**
     * 2. Perhitungan estimasi biaya dari channel (flat, percent, minimum_fee, maximum_fee)
     */
    public function test_calculate_customer_fee_from_tripay_channel_components(): void
    {
        $tripayService = app(TripayService::class);

        $channelWithAllComponents = (object) [
            'code'         => 'QRIS',
            'fee_customer' => (object) ['flat' => 750, 'percent' => 0.70],
            'minimum_fee'  => 2000,
            'maximum_fee'  => 10000,
        ];

        // 0.7% dari 100.000 = 700 + 750 = 1.450 -> terkena minimum_fee = 2.000
        $this->assertSame(2000, $tripayService->calculateCustomerFee($channelWithAllComponents, 100000));

        // 0.7% dari 500.000 = 3.500 + 750 = 4.250 -> di antara min & max
        $this->assertSame(4250, $tripayService->calculateCustomerFee($channelWithAllComponents, 500000));

        // 0.7% dari 2.000.000 = 14.000 + 750 = 14.750 -> terkena maximum_fee = 10.000
        $this->assertSame(10000, $tripayService->calculateCustomerFee($channelWithAllComponents, 2000000));

        // Nominal 0 -> biaya 0
        $this->assertSame(0, $tripayService->calculateCustomerFee($channelWithAllComponents, 0));
    }

    /**
     * 3 & 5. Pembuatan transaksi QRIS, penyimpanan response Tripay ke invoice,
     *        dan pencegahan akses produk sebelum pembayaran terkonfirmasi.
     */
    public function test_create_qris_transaction_saves_tripay_response_and_prevents_premature_access(): void
    {
        $capturedRequest = null;

        Http::fake([
            '*/merchant/payment-channel*' => Http::response([
                'success' => true,
                'data'    => $this->sampleTripayChannels(),
            ], 200),
            '*/transaction/create*' => function ($request) use (&$capturedRequest) {
                $capturedRequest = $request->data();
                $nettAmount = (int) ($capturedRequest['amount'] ?? 200000);
                $feeCustomer = 2150; // 750 + (0.7% * 200000 = 1400)
                return Http::response([
                    'success' => true,
                    'message' => 'Success',
                    'data'    => [
                        'reference'      => 'T123450000001',
                        'merchant_ref'   => $capturedRequest['merchant_ref'],
                        'payment_method' => 'QRIS',
                        'payment_name'   => 'QRIS (Customizable)',
                        'amount'         => $nettAmount + $feeCustomer,
                        'fee_merchant'   => 0,
                        'fee_customer'   => $feeCustomer,
                        'total_fee'      => $feeCustomer,
                        'amount_received'=> $nettAmount,
                        'pay_code'       => null,
                        'qr_string'      => '00020101021226680016ID.CO.TRIPAY.WWW0118936009180000000000',
                        'qr_url'         => 'https://tripay.co.id/qr/T123450000001',
                        'checkout_url'   => 'https://tripay.co.id/checkout/T123450000001',
                        'status'         => 'UNPAID',
                        'expired_time'   => Carbon::now()->addHours(24)->timestamp,
                        'instructions'   => [
                            [
                                'title' => 'QRIS',
                                'steps' => ['Buka aplikasi e-wallet', 'Scan QRIS dan bayar'],
                            ],
                        ],
                    ],
                ], 200);
            },
        ]);

        $response = $this->actingAs($this->buyer)->postJson(route('invoice.store'), [
            'type'            => 'course',
            'id'              => $this->course->id,
            'discount_amount' => 100000,
            'nett_amount'     => 200000,
            'total_amount'    => 202150,
            'payment_channel' => 'QRIS',
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('success', true);

        // Pastikan request ke Tripay mengirim nett_amount (200.000) sebagai amount dan order_items price
        $this->assertNotNull($capturedRequest);
        $this->assertEquals(200000, (int) $capturedRequest['amount']);
        $this->assertEquals(200000, (int) $capturedRequest['order_items'][0]['price']);
        $this->assertSame('QRIS', $capturedRequest['method']);
        $this->assertSame('081234567890', $capturedRequest['customer_phone']);

        // Pastikan invoice menyimpan data aktual dari response Tripay (bukan Rp5.000 statis)
        $invoice = Invoice::latest()->first();
        $this->assertNotNull($invoice);
        $this->assertSame('pending', $invoice->status);
        $this->assertSame('tripay', $invoice->payment_method);
        $this->assertSame('QRIS', $invoice->payment_channel);
        $this->assertSame('T123450000001', $invoice->payment_reference);
        $this->assertEquals(200000, (int) $invoice->nett_amount);
        $this->assertEquals(2150, (int) $invoice->transaction_fee);
        $this->assertEquals(202150, (int) $invoice->amount);
        $this->assertSame('https://tripay.co.id/qr/T123450000001', $invoice->qr_code_url);

        // Pastikan sertifikat belum diberikan saat invoice masih pending
        $this->assertDatabaseMissing('certificate_participants', [
            'certificate_id' => $this->certificate->id,
            'user_id'        => $this->buyer->id,
        ]);
    }

    /**
     * 4 & 5. Pembuatan transaksi Virtual Account untuk Bundle & Cicilan,
     *        memastikan enrollment individual bundle tidak dibuat sebelum PAID.
     */
    public function test_create_virtual_account_transaction_for_bundle_and_installment(): void
    {
        $bundle = Bundle::create([
            'user_id'             => $this->buyer->id,
            'title'               => 'Paket Bundling Akuntansi & Pajak',
            'slug'                => 'paket-bundling-akuntansi-pajak',
            'price'               => 350000,
            'strikethrough_price' => 500000,
            'status'              => 'published',
        ]);

        BundleItem::create([
            'bundle_id'       => $bundle->id,
            'bundleable_type' => Course::class,
            'bundleable_id'   => $this->course->id,
            'price'           => 200000,
        ]);

        Http::fake([
            '*/merchant/payment-channel*' => Http::response([
                'success' => true,
                'data'    => $this->sampleTripayChannels(),
            ], 200),
            '*/transaction/create*' => function ($request) {
                $data = $request->data();
                $nettAmount = (int) ($data['amount'] ?? 350000);
                $feeCustomer = 4250;
                return Http::response([
                    'success' => true,
                    'data'    => [
                        'reference'      => 'T123450000002',
                        'merchant_ref'   => $data['merchant_ref'],
                        'payment_method' => 'BRIVA',
                        'payment_name'   => 'BRI Virtual Account',
                        'amount'         => $nettAmount + $feeCustomer,
                        'fee_merchant'   => 0,
                        'fee_customer'   => $feeCustomer,
                        'total_fee'      => $feeCustomer,
                        'amount_received'=> $nettAmount,
                        'pay_code'       => '77777081234567890',
                        'qr_string'      => null,
                        'qr_url'         => null,
                        'checkout_url'   => 'https://tripay.co.id/checkout/T123450000002',
                        'status'         => 'UNPAID',
                        'expired_time'   => Carbon::now()->addHours(24)->timestamp,
                    ],
                ], 200);
            },
        ]);

        $response = $this->actingAs($this->buyer)->postJson(route('invoice.store.bundle'), [
            'bundle_id'       => $bundle->id,
            'payment_channel' => 'BRIVA',
            'nett_amount'     => 350000,
            'total_amount'    => 354250,
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('success', true);

        $bundleInvoice = Invoice::latest()->first();
        $this->assertSame('tripay', $bundleInvoice->payment_method);
        $this->assertSame('BRIVA', $bundleInvoice->payment_channel);
        $this->assertSame('T123450000002', $bundleInvoice->payment_reference);
        $this->assertSame('77777081234567890', $bundleInvoice->va_number);
        $this->assertEquals(350000, (int) $bundleInvoice->nett_amount);
        $this->assertEquals(4250, (int) $bundleInvoice->transaction_fee);
        $this->assertEquals(354250, (int) $bundleInvoice->amount);

        // Pastikan enrollment_courses belum dibuat selama invoice bundle masih pending
        $this->assertDatabaseMissing('enrollment_courses', [
            'invoice_id' => $bundleInvoice->id,
            'course_id'  => $this->course->id,
        ]);

        // Uji pembuatan cicilan dengan Tripay Virtual Account
        ProductInstallmentTerm::create([
            'termable_type' => Course::class,
            'termable_id'   => $this->course->id,
            'term_number'   => 1,
            'amount'        => 100000,
            'due_date'      => Carbon::now()->addDays(7)->toDateString(),
        ]);
        ProductInstallmentTerm::create([
            'termable_type' => Course::class,
            'termable_id'   => $this->course->id,
            'term_number'   => 2,
            'amount'        => 100000,
            'due_date'      => Carbon::now()->addDays(30)->toDateString(),
        ]);

        $installmentRes = $this->actingAs($this->buyer)->postJson(route('installment.store'), [
            'type'            => 'course',
            'id'              => $this->course->id,
            'payment_channel' => 'BRIVA',
        ]);

        $installmentRes->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('dp_amount', 104250);

        $parentInvoice = Invoice::find($installmentRes->json('invoice_id'));
        $dpInvoice = Invoice::find($installmentRes->json('child_invoice_id'));

        $this->assertSame('tripay', $dpInvoice->payment_method);
        $this->assertSame('BRIVA', $dpInvoice->payment_channel);
        $this->assertEquals(100000, (int) $dpInvoice->nett_amount);
        $this->assertEquals(4250, (int) $dpInvoice->transaction_fee);
        $this->assertEquals(104250, (int) $dpInvoice->amount);
        $this->assertEquals(208500, (int) $parentInvoice->amount);
    }

    /**
     * 6. Callback dengan signature tidak valid ditolak dengan 401
     */
    public function test_callback_with_invalid_signature_returns_401(): void
    {
        $invoice = Invoice::create([
            'user_id'           => $this->buyer->id,
            'invoice_code'      => 'LUC-2600001',
            'amount'            => 204250,
            'nett_amount'       => 200000,
            'transaction_fee'   => 4250,
            'payment_method'    => 'tripay',
            'payment_channel'   => 'BRIVA',
            'payment_reference' => 'T123450000099',
            'status'            => 'pending',
        ]);

        $payload = json_encode([
            'reference'         => 'T123450000099',
            'merchant_ref'      => $invoice->invoice_code,
            'payment_method'    => 'BRI Virtual Account',
            'payment_method_code' => 'BRIVA',
            'total_amount'      => 204250,
            'fee_merchant'      => 0,
            'fee_customer'      => 4250,
            'total_fee'         => 4250,
            'amount_received'   => 200000,
            'is_closed_payment' => 1,
            'status'            => 'PAID',
            'paid_at'           => time(),
        ]);

        $response = $this->call(
            'POST',
            '/api/callback/tripay',
            [],
            [],
            [],
            [
                'CONTENT_TYPE'            => 'application/json',
                'HTTP_X_CALLBACK_EVENT'   => 'payment_status',
                'HTTP_X_CALLBACK_SIGNATURE' => 'invalid-signature-hash',
            ],
            $payload
        );

        $response->assertStatus(401)
            ->assertJsonPath('success', false);

        $this->assertSame('pending', $invoice->fresh()->status);
    }

    /**
     * 7 & 11. Callback dengan status PAID menjalankan settlement lengkap
     *         dan callback duplikat bersifat idempotent (tidak diproses dua kali).
     */
    public function test_callback_paid_settles_invoice_and_is_idempotent_on_duplicate_callbacks(): void
    {
        Event::fake([TransactionPaid::class]);

        $invoice = Invoice::create([
            'user_id'             => $this->buyer->id,
            'referred_by_user_id' => $this->affiliate->id,
            'invoice_code'        => 'LUC-2600002',
            'amount'              => 204250,
            'nett_amount'         => 200000,
            'transaction_fee'     => 4250,
            'payment_method'      => 'tripay',
            'payment_channel'     => 'BRIVA',
            'payment_reference'   => 'T123450000100',
            'status'              => 'pending',
        ]);

        EnrollmentCourse::create([
            'invoice_id' => $invoice->id,
            'course_id'  => $this->course->id,
            'price'      => 200000,
            'progress'   => 0,
        ]);

        $payload = json_encode([
            'reference'           => 'T123450000100',
            'merchant_ref'        => 'LUC-2600002',
            'payment_method'      => 'BRI Virtual Account',
            'payment_method_code' => 'BRIVA',
            'total_amount'        => 204250,
            'fee_merchant'        => 0,
            'fee_customer'        => 4250,
            'total_fee'           => 4250,
            'amount_received'     => 200000,
            'is_closed_payment'   => 1,
            'status'              => 'PAID',
            'paid_at'             => time(),
        ]);

        $signature = hash_hmac('sha256', $payload, config('tripay.private_key'));

        // Callback pertama (PAID)
        $response1 = $this->call(
            'POST',
            '/api/callback/tripay',
            [],
            [],
            [],
            [
                'CONTENT_TYPE'              => 'application/json',
                'HTTP_X_CALLBACK_EVENT'     => 'payment_status',
                'HTTP_X_CALLBACK_SIGNATURE' => $signature,
            ],
            $payload
        );

        $response1->assertStatus(200)
            ->assertJsonPath('success', true);

        $invoice->refresh();
        $this->assertSame('paid', $invoice->status);
        $this->assertNotNull($invoice->paid_at);

        // Sertifikat peserta terdaftar setelah PAID
        $this->assertDatabaseHas('certificate_participants', [
            'certificate_id' => $this->certificate->id,
            'user_id'        => $this->buyer->id,
        ]);

        // Komisi affiliate tercatat tepat 1 kali
        $this->assertSame(1, AffiliateEarning::where('invoice_id', $invoice->id)->count());
        Event::assertDispatchedTimes(TransactionPaid::class, 1);

        // Callback kedua (duplikat)
        $response2 = $this->call(
            'POST',
            '/api/callback/tripay',
            [],
            [],
            [],
            [
                'CONTENT_TYPE'              => 'application/json',
                'HTTP_X_CALLBACK_EVENT'     => 'payment_status',
                'HTTP_X_CALLBACK_SIGNATURE' => $signature,
            ],
            $payload
        );

        $response2->assertStatus(200)
            ->assertJsonPath('success', true);

        // Pastikan komisi affiliate & event tidak tercatat dua kali
        $this->assertSame(1, AffiliateEarning::where('invoice_id', $invoice->id)->count());
        Event::assertDispatchedTimes(TransactionPaid::class, 1);
    }

    /**
     * 8 & 9. Callback dengan status EXPIRED dan FAILED menjalankan mekanisme kegagalan
     *        serta mengembalikan kuota voucher & poin.
     */
    public function test_callback_expired_and_failed_marks_invoice_failed_and_restores_voucher(): void
    {
        $discountCode = DiscountCode::create([
            'code'             => 'HEMAT50',
            'name'             => 'Diskon 50rb',
            'type'             => 'fixed',
            'value'            => 50000,
            'usage_limit'      => 10,
            'used_count'       => 2,
            'starts_at'        => now()->subDay(),
            'expires_at'       => now()->addDays(7),
            'is_active'        => true,
        ]);

        foreach (['EXPIRED', 'FAILED'] as $index => $status) {
            $code = 'LUC-260010' . $index;
            $ref = 'T12345000020' . $index;

            $invoice = Invoice::create([
                'user_id'           => $this->buyer->id,
                'invoice_code'      => $code,
                'amount'            => 154250,
                'nett_amount'       => 150000,
                'discount_amount'   => 50000,
                'transaction_fee'   => 4250,
                'payment_method'    => 'tripay',
                'payment_channel'   => 'BRIVA',
                'payment_reference' => $ref,
                'status'            => 'pending',
            ]);

            DiscountUsage::create([
                'discount_code_id' => $discountCode->id,
                'user_id'          => $this->buyer->id,
                'invoice_id'       => $invoice->id,
                'discount_amount'  => 50000,
            ]);

            $payload = json_encode([
                'reference'           => $ref,
                'merchant_ref'        => $code,
                'payment_method'      => 'BRI Virtual Account',
                'payment_method_code' => 'BRIVA',
                'total_amount'        => 154250,
                'is_closed_payment'   => 1,
                'status'              => $status,
            ]);

            $signature = hash_hmac('sha256', $payload, config('tripay.private_key'));

            $res = $this->call(
                'POST',
                '/api/callback/tripay',
                [],
                [],
                [],
                [
                    'CONTENT_TYPE'              => 'application/json',
                    'HTTP_X_CALLBACK_EVENT'     => 'payment_status',
                    'HTTP_X_CALLBACK_SIGNATURE' => $signature,
                ],
                $payload
            );

            $res->assertStatus(200)
                ->assertJsonPath('success', true);

            $this->assertSame('failed', $invoice->fresh()->status);
            $this->assertDatabaseMissing('discount_usages', ['invoice_id' => $invoice->id]);
        }

        $this->assertEquals(0, (int) $discountCode->fresh()->used_count);
    }

    /**
     * 10. Callback dengan status REFUND mencabut hak akses, sertifikat, dan komisi affiliate
     *     jika sebelumnya sudah berstatus PAID.
     */
    public function test_callback_refund_revokes_access_certificate_and_commissions_when_previously_paid(): void
    {
        $invoice = Invoice::create([
            'user_id'             => $this->buyer->id,
            'referred_by_user_id' => $this->affiliate->id,
            'invoice_code'        => 'LUC-2600055',
            'amount'              => 204250,
            'nett_amount'         => 200000,
            'transaction_fee'     => 4250,
            'payment_method'      => 'tripay',
            'payment_channel'     => 'BRIVA',
            'payment_reference'   => 'T123450000555',
            'status'              => 'paid',
            'paid_at'             => now(),
        ]);

        EnrollmentCourse::create([
            'invoice_id' => $invoice->id,
            'course_id'  => $this->course->id,
            'price'      => 200000,
            'progress'   => 0,
        ]);

        CertificateParticipant::create([
            'certificate_id' => $this->certificate->id,
            'user_id'        => $this->buyer->id,
        ]);

        AffiliateEarning::create([
            'affiliate_user_id' => $this->affiliate->id,
            'invoice_id'        => $invoice->id,
            'amount'            => 20000,
            'rate'              => 10,
            'status'            => 'approved',
        ]);

        $payload = json_encode([
            'reference'           => 'T123450000555',
            'merchant_ref'        => 'LUC-2600055',
            'payment_method'      => 'BRI Virtual Account',
            'payment_method_code' => 'BRIVA',
            'total_amount'        => 204250,
            'is_closed_payment'   => 1,
            'status'              => 'REFUND',
        ]);

        $signature = hash_hmac('sha256', $payload, config('tripay.private_key'));

        $response = $this->call(
            'POST',
            '/api/callback/tripay',
            [],
            [],
            [],
            [
                'CONTENT_TYPE'              => 'application/json',
                'HTTP_X_CALLBACK_EVENT'     => 'payment_status',
                'HTTP_X_CALLBACK_SIGNATURE' => $signature,
            ],
            $payload
        );

        $response->assertStatus(200)
            ->assertJsonPath('success', true);

        $invoice->refresh();
        $this->assertSame('failed', $invoice->status);
        $this->assertNull($invoice->paid_at);

        // Sertifikat & komisi affiliate dicabut
        $this->assertDatabaseMissing('certificate_participants', [
            'certificate_id' => $this->certificate->id,
            'user_id'        => $this->buyer->id,
        ]);
        $this->assertDatabaseMissing('affiliate_earnings', [
            'invoice_id' => $invoice->id,
        ]);
    }

    /**
     * 12. Callback dengan ketidaksesuaian nominal atau merchant_ref ditolak dengan 422.
     */
    public function test_callback_rejects_mismatched_amount_or_merchant_ref(): void
    {
        $invoice = Invoice::create([
            'user_id'           => $this->buyer->id,
            'invoice_code'      => 'LUC-2600099',
            'amount'            => 204250,
            'nett_amount'       => 200000,
            'transaction_fee'   => 4250,
            'payment_method'    => 'tripay',
            'payment_channel'   => 'BRIVA',
            'payment_reference' => 'T123450000999',
            'status'            => 'pending',
        ]);

        // 1. Nominal tidak sesuai (total_amount = 100000 padahal seharusnya 204250)
        $badAmountPayload = json_encode([
            'reference'           => 'T123450000999',
            'merchant_ref'        => 'LUC-2600099',
            'payment_method_code' => 'BRIVA',
            'total_amount'        => 100000,
            'is_closed_payment'   => 1,
            'status'              => 'PAID',
        ]);
        $sig1 = hash_hmac('sha256', $badAmountPayload, config('tripay.private_key'));

        $res1 = $this->call(
            'POST',
            '/api/callback/tripay',
            [],
            [],
            [],
            [
                'CONTENT_TYPE'              => 'application/json',
                'HTTP_X_CALLBACK_EVENT'     => 'payment_status',
                'HTTP_X_CALLBACK_SIGNATURE' => $sig1,
            ],
            $badAmountPayload
        );
        $res1->assertStatus(422)
            ->assertJsonPath('message', 'Invalid payment amount');
        $this->assertSame('pending', $invoice->fresh()->status);

        // 2. Merchant reference tidak sesuai dengan invoice yang ditemukan lewat reference
        $badRefPayload = json_encode([
            'reference'           => 'T123450000999',
            'merchant_ref'        => 'LUC-WRONG-CODE',
            'payment_method_code' => 'BRIVA',
            'total_amount'        => 204250,
            'is_closed_payment'   => 1,
            'status'              => 'PAID',
        ]);
        $sig2 = hash_hmac('sha256', $badRefPayload, config('tripay.private_key'));

        $res2 = $this->call(
            'POST',
            '/api/callback/tripay',
            [],
            [],
            [],
            [
                'CONTENT_TYPE'              => 'application/json',
                'HTTP_X_CALLBACK_EVENT'     => 'payment_status',
                'HTTP_X_CALLBACK_SIGNATURE' => $sig2,
            ],
            $badRefPayload
        );
        $res2->assertStatus(422)
            ->assertJsonPath('message', 'Invalid merchant reference');
        $this->assertSame('pending', $invoice->fresh()->status);
    }

    /**
     * Test PaymentGatewayManager and /payment/channels & /payment/calculate-fee endpoints (mirrored from biinspira)
     */
    public function test_payment_gateway_manager_and_public_fee_calculation_endpoints(): void
    {
        $manager = app(\App\Services\Payment\PaymentGatewayManager::class);
        $this->assertSame('tripay', $manager->getDefaultDriver());
        $this->assertInstanceOf(\App\Services\Payment\Drivers\TripayGateway::class, $manager->driver());

        Http::fake([
            '*/merchant/payment-channel*' => Http::response([
                'success' => true,
                'data' => $this->sampleTripayChannels(),
            ], 200),
            '*/merchant/fee-calculator*' => Http::response([
                'success' => true,
                'data' => [
                    [
                        'code' => 'QRIS',
                        'name' => 'QRIS',
                        'fee' => ['flat' => 750, 'percent' => 0.7],
                        'total_fee' => ['merchant' => 0, 'customer' => 2150],
                    ],
                    [
                        'code' => 'BRIVA',
                        'name' => 'BRI Virtual Account',
                        'fee' => ['flat' => 4250, 'percent' => 0],
                        'total_fee' => ['merchant' => 0, 'customer' => 4250],
                    ],
                ],
            ], 200),
        ]);

        // 1. GET /payment/channels
        $channelsResponse = $this->getJson('/payment/channels');
        $channelsResponse->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('gateway', 'tripay');
        $this->assertNotEmpty($channelsResponse->json('data'));

        // 2. GET /payment/calculate-fee without channel code (returns all channels)
        $feeAllResponse = $this->getJson('/payment/calculate-fee?amount=200000');
        $feeAllResponse->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('gateway', 'tripay');
        $this->assertCount(2, $feeAllResponse->json('data'));

        // 3. POST /payment/calculate-fee with specific channel code (returns single formatted item)
        $feeSpecificResponse = $this->postJson('/payment/calculate-fee', [
            'amount' => 200000,
            'payment_channel' => 'QRIS',
        ]);
        $feeSpecificResponse->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.code', 'QRIS')
            ->assertJsonPath('data.fee_customer', 2150)
            ->assertJsonPath('data.total_amount', 202150);
    }
}
