<?php

namespace Tests\Feature\Payment;

use App\Models\Category;
use App\Models\Course;
use App\Models\EnrollmentCourse;
use App\Models\Invoice;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use Inertia\Testing\AssertableInertia as Assert;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class TripayReturnTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;
    protected Course $course;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutVite();

        Config::set('tripay.active_gateway', 'tripay');
        Config::set('tripay.api_key', 'DEV-TEST-API-KEY');
        Config::set('tripay.private_key', 'DEV-TEST-PRIVATE-KEY');
        Config::set('tripay.merchant_code', 'T12345');
        Config::set('tripay.api_url', 'https://tripay.co.id/api-sandbox');
        Config::set('tripay.sandbox', true);

        Role::firstOrCreate(['name' => 'admin']);
        Role::firstOrCreate(['name' => 'user']);
        Role::firstOrCreate(['name' => 'affiliate']);
        Role::firstOrCreate(['name' => 'mentor']);

        $this->user = User::factory()->create([
            'name' => 'Jane Learner',
            'email' => 'jane@example.com',
            'phone_number' => '08123456780',
        ]);
        $this->user->assignRole('user');

        $category = Category::firstOrCreate(['slug' => 'tech'], ['name' => 'Technology']);

        $this->course = Course::create([
            'title' => 'Mastering Laravel',
            'slug' => 'mastering-laravel',
            'price' => 200000,
            'category_id' => $category->id,
            'level' => 'intermediate',
            'user_id' => $this->user->id,
        ]);
    }

    public function test_tripay_return_auto_syncs_paid_status_and_redirects_to_show(): void
    {
        Http::fake([
            'https://tripay.co.id/api-sandbox/transaction/detail*' => Http::response([
                'success' => true,
                'data' => [
                    'reference' => 'DEV-T123456',
                    'merchant_ref' => 'LUC-2600001',
                    'payment_method' => 'BNI Virtual Account',
                    'payment_method_code' => 'BNIVA',
                    'status' => 'PAID',
                    'total_amount' => 205000,
                    'pay_code' => '9881234567',
                    'qr_url' => null,
                ]
            ], 200),
        ]);

        $invoice = Invoice::create([
            'user_id' => $this->user->id,
            'invoice_code' => 'LUC-2600001',
            'amount' => 205000,
            'nett_amount' => 200000,
            'status' => 'pending',
            'payment_method' => 'TRIPAY',
            'payment_channel' => 'BNIVA',
            'payment_reference' => 'DEV-T123456',
            'expires_at' => Carbon::now()->addDay(),
        ]);

        EnrollmentCourse::create([
            'course_id' => $this->course->id,
            'invoice_id' => $invoice->id,
            'price' => 200000,
            'progress' => 0,
        ]);

        $response = $this->actingAs($this->user)->get('/tripay/return?tripay_reference=DEV-T123456&tripay_merchant_ref=LUC-2600001');

        $response->assertRedirect(route('invoice.show', ['id' => $invoice->id]));

        $invoice->refresh();
        $this->assertEquals('paid', $invoice->status);
    }

    public function test_invoice_show_with_tripay_reference_syncs_status_and_renders_success(): void
    {
        Http::fake([
            'https://tripay.co.id/api-sandbox/transaction/detail*' => Http::response([
                'success' => true,
                'data' => [
                    'reference' => 'DEV-T999888',
                    'merchant_ref' => 'LUC-2600002',
                    'payment_method' => 'QRIS',
                    'payment_method_code' => 'QRIS',
                    'status' => 'PAID',
                    'total_amount' => 205000,
                    'pay_code' => null,
                    'qr_url' => 'https://tripay.co.id/qr/test.png',
                ]
            ], 200),
        ]);

        $invoice = Invoice::create([
            'user_id' => $this->user->id,
            'invoice_code' => 'LUC-2600002',
            'amount' => 205000,
            'nett_amount' => 200000,
            'status' => 'pending',
            'payment_method' => 'TRIPAY',
            'payment_channel' => 'QRIS',
            'payment_reference' => 'DEV-T999888',
            'expires_at' => Carbon::now()->addDay(),
        ]);

        EnrollmentCourse::create([
            'course_id' => $this->course->id,
            'invoice_id' => $invoice->id,
            'price' => 200000,
            'progress' => 0,
        ]);

        $response = $this->actingAs($this->user)->get('/invoice/' . $invoice->id . '?tripay_reference=DEV-T999888&tripay_merchant_ref=LUC-2600002');

        $response->assertStatus(200);
        $response->assertInertia(fn (Assert $page) => $page
            ->component('user/checkout/success')
            ->where('invoice.status', 'paid')
        );

        $invoice->refresh();
        $this->assertEquals('paid', $invoice->status);
    }

    public function test_tripay_return_with_status_paid_query_settles_and_redirects_to_show(): void
    {
        Http::fake([
            'https://tripay.co.id/api-sandbox/transaction/detail*' => Http::response([
                'success' => true,
                'data' => [
                    'reference' => 'DEV-T777111',
                    'merchant_ref' => 'LUC-2600003',
                    'payment_method' => 'QRIS',
                    'payment_method_code' => 'QRIS',
                    'status' => 'PAID',
                    'total_amount' => 205000,
                    'pay_code' => null,
                    'qr_url' => 'https://tripay.co.id/qr/test.png',
                ]
            ], 200),
        ]);

        $invoice = Invoice::create([
            'user_id' => $this->user->id,
            'invoice_code' => 'LUC-2600003',
            'amount' => 205000,
            'nett_amount' => 200000,
            'status' => 'pending',
            'payment_method' => 'TRIPAY',
            'payment_channel' => 'QRIS',
            'payment_reference' => 'DEV-T777111',
            'expires_at' => Carbon::now()->addDay(),
        ]);

        EnrollmentCourse::create([
            'course_id' => $this->course->id,
            'invoice_id' => $invoice->id,
            'price' => 200000,
            'progress' => 0,
        ]);

        $response = $this->actingAs($this->user)->get('/tripay/return?tripay_reference=DEV-T777111&tripay_merchant_ref=LUC-2600003&status=PAID');

        $response->assertRedirect(route('invoice.show', ['id' => $invoice->id]));

        $invoice->refresh();
        $this->assertEquals('paid', $invoice->status);

        // Follow redirect to invoice.show
        $showResponse = $this->actingAs($this->user)->get(route('invoice.show', ['id' => $invoice->id]));
        $showResponse->assertStatus(200);
        $showResponse->assertInertia(fn (Assert $page) => $page
            ->component('user/checkout/success')
            ->where('invoice.status', 'paid')
        );
    }
}
