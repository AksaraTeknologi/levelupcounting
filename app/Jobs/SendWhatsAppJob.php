<?php

namespace App\Jobs;

use App\Services\WhatsApp\WhatsApp;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Kirim WhatsApp lewat antrean memakai gateway aktif (DEFAULT_WA_GATEWAY).
 */
class SendWhatsAppJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * Data payload messages: [['phone' => '628...', 'message' => '...'], ...]
     */
    protected array $messages;

    /**
     * Action type: 'text' or 'link'
     */
    protected string $type;

    public function __construct(array $messages, string $type = 'text')
    {
        if (isset($messages['phone'])) {
            $messages = [$messages];
        }

        // ref_id tetap sama di setiap retry job, sehingga Messara tidak mengirim ulang pesan yang sudah terkirim.
        $this->messages = array_map(
            fn ($message) => ((array) $message) + ['ref_id' => (string) Str::uuid()],
            array_values($messages)
        );
        $this->type = $type;
    }

    public function handle(): void
    {
        Log::info('Processing SendWhatsAppJob using gateway: '.WhatsApp::gateway(), [
            'count' => count($this->messages),
            'type' => $this->type,
        ]);

        $result = WhatsApp::sendTextResult($this->messages);

        if ($result->isSent()) {
            return;
        }

        $reasons = array_filter(array_merge([$result->reason], array_column($result->items, 'reason')));
        $error = new \Exception("Gagal mengirim WhatsApp via {$result->gateway} (".implode(', ', $reasons ?: [$result->status->value]).')');

        // Kuota harian habis atau kredensial kosong: retry tidak akan membantu.
        if (array_intersect($reasons, ['daily_limit_reached', 'missing_credentials'])) {
            $this->fail($error);

            return;
        }

        throw $error;
    }
}
