import axios from 'axios';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CreditCard, QrCode, Building2, Store, Wallet, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export interface PaymentChannel {
    group: string;
    code: string;
    name: string;
    type: string;
    fee_merchant?: {
        flat: number;
        percent: number;
    };
    fee_customer?: {
        flat: number;
        percent: number;
    };
    total_fee?: {
        flat: number;
        percent: number;
    };
    minimum_fee?: number;
    maximum_fee?: number;
    icon_url?: string;
    active: boolean;
}

export interface CalculatedFeeData {
    code: string;
    name: string;
    base_amount: number;
    fee_customer: number;
    fee_merchant: number;
    total_fee: number;
    total_amount: number;
    minimum_fee?: number | null;
    maximum_fee?: number | null;
    fee_formula?: {
        flat: number;
        percent: number;
    };
    raw?: any;
}

const DEFAULT_CHANNELS: PaymentChannel[] = [
    {
        group: 'Virtual Account',
        code: 'BNIVA',
        name: 'BNI Virtual Account',
        type: 'direct',
        icon_url: 'https://assets.tripay.co.id/upload/payment-icon/n22Qsh8jMa1583433577.png',
        active: true,
    },
    {
        group: 'Virtual Account',
        code: 'BRIVA',
        name: 'BRI Virtual Account',
        type: 'direct',
        icon_url: 'https://assets.tripay.co.id/upload/payment-icon/8WQ3APST5s1579461828.png',
        active: true,
    },
    {
        group: 'Virtual Account',
        code: 'MANDIRIVA',
        name: 'Mandiri Virtual Account',
        type: 'direct',
        icon_url: 'https://assets.tripay.co.id/upload/payment-icon/T9Z012UE331583531536.png',
        active: true,
    },
    {
        group: 'Virtual Account',
        code: 'BCAVA',
        name: 'BCA Virtual Account',
        type: 'direct',
        icon_url: 'https://assets.tripay.co.id/upload/payment-icon/ytBKvaleGy1605201833.png',
        active: true,
    },
    {
        group: 'Virtual Account',
        code: 'BSIVA',
        name: 'BSI Virtual Account',
        type: 'direct',
        icon_url: 'https://upload.wikimedia.org/wikipedia/commons/a/a0/Bank_Syariah_Indonesia.svg',
        active: true,
    },
    {
        group: 'Convenience Store',
        code: 'ALFAMART',
        name: 'Alfamart',
        type: 'direct',
        icon_url: 'https://upload.wikimedia.org/wikipedia/commons/8/86/Alfamart_logo.svg',
        active: true,
    },
    {
        group: 'Convenience Store',
        code: 'INDOMARET',
        name: 'Indomaret',
        type: 'direct',
        icon_url: 'https://assets.tripay.co.id/upload/payment-icon/zNzuO5AuLw1583513974.png',
        active: true,
    },
    {
        group: 'QRIS',
        code: 'QRIS',
        name: 'QRIS',
        type: 'direct',
        icon_url: 'https://assets.tripay.co.id/upload/payment-icon/BpE4BPVyIw1605597490.png',
        active: true,
    },
];

const CHANNEL_FALLBACK_ICONS: Record<string, string> = {
    BNIVA: 'https://assets.tripay.co.id/upload/payment-icon/n22Qsh8jMa1583433577.png',
    BRIVA: 'https://assets.tripay.co.id/upload/payment-icon/8WQ3APST5s1579461828.png',
    MANDIRIVA: 'https://assets.tripay.co.id/upload/payment-icon/T9Z012UE331583531536.png',
    BCAVA: 'https://assets.tripay.co.id/upload/payment-icon/ytBKvaleGy1605201833.png',
    BSIVA: 'https://upload.wikimedia.org/wikipedia/commons/a/a0/Bank_Syariah_Indonesia.svg',
    INDOMARET: 'https://assets.tripay.co.id/upload/payment-icon/zNzuO5AuLw1583513974.png',
    ALFAMART: 'https://upload.wikimedia.org/wikipedia/commons/8/86/Alfamart_logo.svg',
    QRIS: 'https://assets.tripay.co.id/upload/payment-icon/BpE4BPVyIw1605597490.png',
    QRISC: 'https://assets.tripay.co.id/upload/payment-icon/m9FtFwaBCg1623157494.png',
    QRIS2: 'https://assets.tripay.co.id/upload/payment-icon/8ewGzP6SWe1649667701.png',
    OVO: 'https://assets.tripay.co.id/upload/payment-icon/fH6Y7wDT171586199243.png',
    DANA: 'https://assets.tripay.co.id/upload/payment-icon/sj3UHLu8Tu1655719621.png',
    SHOPEEPAY: 'https://assets.tripay.co.id/upload/payment-icon/d204uajhlS1655719774.png',
};

interface PaymentChannelSelectorProps {
    selectedChannel: string;
    onSelectChannel: (code: string) => void;
    amount?: number;
    onFeeCalculated?: (feeData: CalculatedFeeData | null, error: string | null) => void;
    className?: string;
}

export default function PaymentChannelSelector({
    selectedChannel,
    onSelectChannel,
    amount,
    onFeeCalculated,
    className = '',
}: PaymentChannelSelectorProps) {
    const { t } = useTranslation('common');
    const [channels, setChannels] = useState<PaymentChannel[]>(DEFAULT_CHANNELS);
    const [, setGateway] = useState<string>('tripay');
    const [loading, setLoading] = useState<boolean>(true);
    const [channelError, setChannelError] = useState<string | null>(null);

    const [feeMap, setFeeMap] = useState<Record<string, CalculatedFeeData>>({});
    const [feeLoading, setFeeLoading] = useState<boolean>(false);
    const [feeError, setFeeError] = useState<string | null>(null);
    const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

    const getChannelIconUrl = (channel: PaymentChannel) => {
        const code = (channel.code || '').toUpperCase();
        if (imageErrors[code]) {
            return null;
        }
        return channel.icon_url || CHANNEL_FALLBACK_ICONS[code] || null;
    };

    // 1. Fetch active payment channels list
    useEffect(() => {
        let isMounted = true;
        const fetchChannels = async () => {
            try {
                setLoading(true);
                setChannelError(null);
                const response = await axios.get('/payment/channels');
                if (isMounted) {
                    if (response.data && response.data.success && Array.isArray(response.data.data) && response.data.data.length > 0) {
                        setGateway(response.data.gateway || 'tripay');
                        const rawChannels: PaymentChannel[] = response.data.data;
                        const activeChannels = rawChannels.filter((c) => c.active !== false);
                        const finalChannels = activeChannels.length > 0 ? activeChannels : DEFAULT_CHANNELS;
                        setChannels(finalChannels);
                    } else {
                        setChannels(DEFAULT_CHANNELS);
                    }
                }
            } catch (err: any) {
                if (isMounted) {
                    console.error('Error fetching payment channels:', err);
                    setChannels(DEFAULT_CHANNELS);
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        fetchChannels();

        return () => {
            isMounted = false;
        };
    }, []);

    // 2. Dynamic Tripay Fee Calculation when amount changes
    useEffect(() => {
        if (amount === undefined || amount === null || amount <= 0) {
            setFeeError(null);
            setFeeMap({});
            onFeeCalculated?.(null, null);
            return;
        }

        let isMounted = true;
        const fetchFees = async () => {
            setFeeLoading(true);
            setFeeError(null);
            try {
                const response = await axios.get('/payment/calculate-fee', {
                    params: { amount },
                });

                if (isMounted) {
                    if (response.data && response.data.success) {
                        const data = response.data.data;
                        const map: Record<string, CalculatedFeeData> = {};

                        if (Array.isArray(data)) {
                            data.forEach((item: CalculatedFeeData) => {
                                if (item.code) {
                                    map[item.code.toUpperCase()] = item;
                                }
                            });
                        } else if (data && data.code) {
                            map[data.code.toUpperCase()] = data;
                        }

                        setFeeMap(map);

                        const currentCode = (selectedChannel || '').toUpperCase();
                        const selectedFee = currentCode ? (map[currentCode] || null) : null;
                        onFeeCalculated?.(selectedFee, null);
                    } else {
                        const msg = response.data?.message || 'Biaya pembayaran belum dapat diperoleh. Silakan coba kembali atau pilih metode pembayaran lain.';
                        setFeeError(msg);
                        onFeeCalculated?.(null, msg);
                    }
                }
            } catch (err: any) {
                if (isMounted) {
                    const rawMsg = err.response?.data?.message;
                    const msg = rawMsg && rawMsg !== 'Unauthenticated.'
                        ? rawMsg
                        : 'Biaya pembayaran belum dapat diperoleh. Silakan coba kembali atau pilih metode pembayaran lain.';
                    setFeeError(msg);
                    onFeeCalculated?.(null, msg);
                }
            } finally {
                if (isMounted) {
                    setFeeLoading(false);
                }
            }
        };

        fetchFees();

        return () => {
            isMounted = false;
        };
    }, [amount]);

    // 3. React to selectedChannel change
    useEffect(() => {
        if (!amount || amount <= 0) return;
        const currentCode = (selectedChannel || '').toUpperCase();
        if (!currentCode) {
            setFeeError(null);
            onFeeCalculated?.(null, null);
            return;
        }
        if (feeMap[currentCode]) {
            setFeeError(null);
            onFeeCalculated?.(feeMap[currentCode], null);
        } else if (Object.keys(feeMap).length > 0) {
            // If channel is not in bulk map, query specifically
            let isMounted = true;
            axios.get('/payment/calculate-fee', {
                params: { amount, payment_channel: selectedChannel },
            }).then((res) => {
                if (isMounted && res.data?.success && res.data?.data) {
                    const item = res.data.data;
                    setFeeMap((prev) => ({ ...prev, [item.code.toUpperCase()]: item }));
                    setFeeError(null);
                    onFeeCalculated?.(item, null);
                }
            }).catch((err) => {
                if (isMounted) {
                    const msg = err.response?.data?.message || 'Biaya pembayaran belum dapat diperoleh. Silakan coba kembali atau pilih metode pembayaran lain.';
                    setFeeError(msg);
                    onFeeCalculated?.(null, msg);
                }
            });

            return () => {
                isMounted = false;
            };
        }
    }, [selectedChannel]);

    // Group channels by their category
    const groupedChannels = useMemo(() => {
        const groups: Record<string, PaymentChannel[]> = {};
        channels.forEach((channel) => {
            const groupName = channel.group || 'Metode Lainnya';
            if (!groups[groupName]) {
                groups[groupName] = [];
            }
            groups[groupName].push(channel);
        });
        return groups;
    }, [channels]);

    const getGroupIcon = (groupName: string) => {
        const lower = groupName.toLowerCase();
        if (lower.includes('virtual account') || lower.includes('transfer') || lower.includes('bank')) {
            return <Building2 className="h-4 w-4 text-[#1d52a2]" />;
        }
        if (lower.includes('qris') || lower.includes('qr')) {
            return <QrCode className="h-4 w-4 text-emerald-600" />;
        }
        if (lower.includes('wallet') || lower.includes('e-money')) {
            return <Wallet className="h-4 w-4 text-orange-500" />;
        }
        if (lower.includes('retail') || lower.includes('convenience') || lower.includes('gerai')) {
            return <Store className="h-4 w-4 text-red-500" />;
        }
        return <CreditCard className="h-4 w-4 text-gray-500" />;
    };

    if (loading) {
        return (
            <div className={`space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-xs dark:border-gray-800 dark:bg-gray-900 ${className}`}>
                <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-5 rounded-full" />
                    <Skeleton className="h-5 w-40" />
                </div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                    <Skeleton className="h-16 w-full rounded-xl" />
                    <Skeleton className="h-16 w-full rounded-xl" />
                    <Skeleton className="h-16 w-full rounded-xl" />
                </div>
            </div>
        );
    }

    if (channels.length === 0) {
        return null;
    }

    return (
        <div className={`space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-xs dark:border-gray-800 dark:bg-gray-900 ${className}`}>
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 dark:border-gray-800">
                <div className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5 text-[#1d52a2] dark:text-blue-400" />
                    <h4 className="font-bold text-gray-900 dark:text-gray-100">{t('paymentChannelSelector.title', 'Pilih Metode Pembayaran')}</h4>
                </div>
                <Badge variant="outline" className="text-xs text-muted-foreground">
                    {t('paymentChannelSelector.autoVerification', 'Verifikasi Otomatis')}
                </Badge>
            </div>

            {feeError && (
                <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50/90 p-3.5 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                    <span className="font-medium leading-relaxed">{feeError}</span>
                </div>
            )}

            {channelError && (
                <div className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{channelError}</span>
                </div>
            )}

            <div className="space-y-4">
                {Object.entries(groupedChannels).map(([groupName, items]) => (
                    <div key={groupName} className="space-y-2">
                        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            {getGroupIcon(groupName)}
                            <span>{groupName}</span>
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {items.map((channel) => {
                                const isSelected = selectedChannel === channel.code;
                                const channelFee = feeMap[channel.code.toUpperCase()];
                                const iconUrl = getChannelIconUrl(channel);

                                return (
                                    <button
                                        key={channel.code}
                                        type="button"
                                        onClick={() => onSelectChannel(channel.code)}
                                        className={`group relative flex items-center justify-between rounded-xl border p-3 text-left transition-all duration-150 cursor-pointer ${
                                            isSelected
                                                ? 'border-[#1d52a2] bg-blue-50/70 ring-2 ring-[#1d52a2]/30 dark:border-blue-500 dark:bg-blue-950/30 dark:ring-blue-500/20'
                                                : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3 min-w-0 pr-2">
                                            {iconUrl ? (
                                                <div className="flex h-9 w-12 shrink-0 items-center justify-center rounded-lg bg-white p-1 border border-gray-100 dark:border-gray-700 shadow-2xs">
                                                    <img
                                                        src={iconUrl}
                                                        alt={channel.name}
                                                        className="max-h-full max-w-full object-contain"
                                                        loading="lazy"
                                                        onError={() => {
                                                            setImageErrors((prev) => ({
                                                                ...prev,
                                                                [channel.code.toUpperCase()]: true,
                                                            }));
                                                        }}
                                                    />
                                                </div>
                                            ) : (
                                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                                                    {getGroupIcon(channel.group)}
                                                </div>
                                            )}

                                            <div className="truncate">
                                                <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                                                    {channel.name}
                                                </p>
                                                <div className="flex items-center gap-2">
                                                    {channelFee && (
                                                        <span className="text-[11px] font-medium text-blue-700 dark:text-blue-300">
                                                            {channelFee.fee_customer === 0
                                                                ? t('paymentChannelSelector.freeOfCharge', 'Bebas Biaya')
                                                                : `+Rp ${channelFee.fee_customer.toLocaleString('id-ID')}`}
                                                        </span>
                                                    )}
                                                    {feeLoading && !channelFee && amount && amount > 0 && (
                                                        <span className="text-[10px] text-muted-foreground animate-pulse">
                                                            {t('paymentChannelSelector.calculatingFee', 'Menghitung biaya...')}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="shrink-0 pl-1">
                                            {isSelected ? (
                                                <CheckCircle2 className="h-5 w-5 text-[#1d52a2] dark:text-blue-400" />
                                            ) : (
                                                <div className="h-4 w-4 rounded-full border border-gray-300 dark:border-gray-600 group-hover:border-gray-400" />
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

