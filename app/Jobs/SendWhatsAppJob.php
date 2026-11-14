<?php

namespace App\Jobs;

use App\Services\MessaraService;
use App\Traits\WablasTrait;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class SendWhatsAppJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels, WablasTrait;

    /**
     * Data payload messages
     *
     * @var array
     */
    protected array $messages;

    /**
     * Action type: 'text' or 'link'
     *
     * @var string
     */
    protected string $type;

    /**
     * Create a new job instance.
     */
    public function __construct(array $messages, string $type = 'text')
    {
        $this->messages = $messages;
        $this->type = $type;
    }

    /**
     * Execute the job.
     */
    public function handle(): void
    {
        $gateway = config('services.default_wa_gateway', 'messara');

        Log::info("Processing SendWhatsAppJob using gateway: {$gateway}", [
            'count' => count($this->messages),
            'type'  => $this->type,
        ]);

        if ($gateway === 'messara') {
            if ($this->type === 'link') {
                MessaraService::sendLink($this->messages);
            } else {
                MessaraService::sendText($this->messages);
            }
        } else {
            if ($this->type === 'link') {
                self::sendLink($this->messages);
            } else {
                self::sendText($this->messages);
            }
        }
    }
}

