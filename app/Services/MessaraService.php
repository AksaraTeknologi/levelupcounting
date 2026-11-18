<?php

namespace App\Services;

use App\Services\WhatsApp\MessaraGateway;
use App\Services\WhatsApp\SendResult;

/**
 * Kirim langsung lewat Messara, mengabaikan DEFAULT_WA_GATEWAY.
 * Untuk notifikasi biasa gunakan App\Services\WhatsApp\WhatsApp atau WhatsAppTrait.
 */
class MessaraService
{
    public static function sendText(array $data = []): bool
    {
        return self::sendTextResult($data)->isSent();
    }

    public static function sendTemplate(array $data = []): bool
    {
        return self::sendTemplateResult($data)->isSent();
    }

    public static function sendLink(array $data = []): bool
    {
        return self::sendText($data);
    }

    public static function sendTextResult(array $data = []): SendResult
    {
        return MessaraGateway::sendTextResult($data);
    }

    public static function sendTemplateResult(array $data = []): SendResult
    {
        return MessaraGateway::sendTemplateResult($data);
    }

    /**
     * Kompatibilitas lama: kirim ke endpoint Messara tertentu.
     */
    public static function sendRequest(string $endpoint, array $data = []): bool
    {
        return str_contains($endpoint, 'template') ? self::sendTemplate($data) : self::sendText($data);
    }
}
