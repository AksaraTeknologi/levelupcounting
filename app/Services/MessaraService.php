<?php

namespace App\Services;

use Illuminate\Support\Facades\Log;

class MessaraService
{
    /**
     * Send regular text messages via Messara WhatsApp Gateway (Unofficial / Session Mode)
     *
     * @param array $data Array of ['phone' => '628...', 'message' => '...', 'isGroup' => 'false']
     * @return bool
     */
    public static function sendText(array $data = []): bool
    {
        return self::request('/api/v2/send-message', ['data' => $data]);
    }

    /**
     * Send Official WhatsApp Template (HSM) messages via Messara Gateway
     *
     * @param array $data Array of [
     *   'phone' => '628...',
     *   'template_name' => 'invoice_pembayaran_berhasil',
     *   'language' => 'id',
     *   'params' => ['var1', 'var2', ...]
     * ]
     * @return bool
     */
    public static function sendTemplate(array $data = []): bool
    {
        return self::request('/api/v2/send-template', ['data' => $data]);
    }

    /**
     * Send link message via Messara (delegated to sendText)
     *
     * @param array $data
     * @return bool
     */
    public static function sendLink(array $data = []): bool
    {
        return self::sendText($data);
    }

    /**
     * Execute HTTP POST request to Messara API
     */
    protected static function request(string $endpoint, array $payload): bool
    {
        try {
            $token = config('services.messara.api_key');
            $secretKey = config('services.messara.secret_key');
            $domain = rtrim((string) config('services.messara.domain', 'https://messara.aksarateknologi.co.id'), '/');
            $verifySsl = (bool) config('services.messara.verify_ssl', false);

            if (empty($token)) {
                Log::error('Messara API key is missing');
                return false;
            }

            // Prevent local single-threaded server deadlock if Messara points to the same host/port
            if (app()->environment('local') && (str_contains($domain, 'localhost') || str_contains($domain, '127.0.0.1'))) {
                $currentPort = request()->getPort();
                if ($currentPort && str_contains($domain, ':' . $currentPort)) {
                    Log::info('Messara skipped in local environment to prevent deadlock with self', ['endpoint' => $endpoint]);
                    return true;
                }
            }

            $curl = curl_init();

            $headers = [
                'Content-Type: application/json',
                'Accept: application/json',
            ];

            if (!empty($secretKey)) {
                $headers[] = "Authorization: {$token}.{$secretKey}";
                $headers[] = "X-Api-Key: {$token}";
                $headers[] = "X-Secret-Key: {$secretKey}";
            } else {
                $headers[] = "Authorization: {$token}";
                $headers[] = "X-Api-Key: {$token}";
            }

            curl_setopt($curl, CURLOPT_HTTPHEADER, $headers);
            curl_setopt($curl, CURLOPT_CUSTOMREQUEST, 'POST');
            curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($payload));
            curl_setopt($curl, CURLOPT_URL, $domain . $endpoint);
            curl_setopt($curl, CURLOPT_SSL_VERIFYHOST, $verifySsl ? 2 : 0);
            curl_setopt($curl, CURLOPT_SSL_VERIFYPEER, $verifySsl);
            curl_setopt($curl, CURLOPT_CONNECTTIMEOUT, 10);
            curl_setopt($curl, CURLOPT_TIMEOUT, 30);

            $result = curl_exec($curl);
            $httpCode = curl_getinfo($curl, CURLINFO_HTTP_CODE);

            if (curl_errno($curl)) {
                $errorMsg = curl_error($curl);
                Log::error('Messara cURL Error: ' . $errorMsg, ['endpoint' => $endpoint]);
                curl_close($curl);
                return false;
            }

            curl_close($curl);

            $items = $payload['data'] ?? [];
            $phones = is_array($items) ? array_slice(array_column($items, 'phone'), 0, 10) : [];

            Log::info('Messara Response', [
                'endpoint' => $endpoint,
                'http_code' => $httpCode,
                'recipients_count' => is_array($items) ? count($items) : 0,
                'phones' => $phones,
                'response' => $result,
            ]);

            if ($httpCode === 200 && $result) {
                $response = json_decode($result, true);
                if (isset($response['status']) && $response['status'] === true) {
                    return true;
                }

                Log::error('Messara API returned error', [
                    'endpoint' => $endpoint,
                    'response' => $response,
                ]);
                return false;
            }

            return false;
        } catch (\Throwable $e) {
            Log::error('Exception in MessaraService: ' . $e->getMessage(), [
                'endpoint' => $endpoint,
            ]);
            return false;
        }
    }
}

