<?php

namespace App\Traits;

use App\Services\MessaraService;

trait MessaraTrait
{
    /**
     * Send text message via Messara (Unofficial / Regular Text)
     *
     * @param array $data
     * @return bool
     */
    public static function sendText(array $data = []): bool
    {
        return MessaraService::sendText($data);
    }

    /**
     * Send Official Template (HSM) message via Messara
     *
     * @param array $data
     * @return bool
     */
    public static function sendTemplate(array $data = []): bool
    {
        return MessaraService::sendTemplate($data);
    }

    /**
     * Send link message via Messara
     *
     * @param array $data
     * @return bool
     */
    public static function sendLink(array $data = []): bool
    {
        return MessaraService::sendLink($data);
    }
}

