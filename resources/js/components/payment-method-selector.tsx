import React, { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Building2, Check, ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react';
import axios from 'axios';
import BankLogo from '@/components/bank-logo';
import { rupiahFormatter } from '@/lib/utils';

export interface TripayFeeObject {
    flat?: number;
    percent?: number | string;
}

export interface SupportedBank {
    code?: string;
    name?: string;
    bank_code: string;
    bank_name: string;
    group?: string;
    type?: string;
    fee_merchant?: TripayFeeObject;
    fee_customer?: TripayFeeObject;
    total_fee?: TripayFeeObject;
    minimum_fee?: number | null;
    maximum_fee?: number | null;
    minimum_amount?: number | null;
    maximum_amount?: number | null;
    icon_url?: string | null;
    active?: boolean;
    va_type?: string[];
}

export function calculateChannelFee(
    channel: SupportedBank | null | undefined,
    nettAmount: number,
): number {
    if (!channel || nettAmount <= 0) {
        return 0;
    }

    const feeCustomer = channel.fee_customer || channel.total_fee;
    if (!feeCustomer) {
        return 0;
    }

    const flatFee = Number(feeCustomer.flat ?? 0);
    const percentValue = Number(feeCustomer.percent ?? 0);
    const percentFee = Math.round(nettAmount * (percentValue / 100));

    let calculatedFee = Math.round(flatFee + percentFee);

    const minFee = channel.minimum_fee !== null && channel.minimum_fee !== undefined ? Number(channel.minimum_fee) : 0;
    const maxFee = channel.maximum_fee !== null && channel.maximum_fee !== undefined ? Number(channel.maximum_fee) : 0;

    if (minFee > 0 && calculatedFee < minFee) {
        calculatedFee = minFee;
    }
    if (maxFee > 0 && calculatedFee > maxFee) {
        calculatedFee = maxFee;
    }

    return Math.max(0, calculatedFee);
}

export function formatChannelFeeDescription(
    channel: SupportedBank | null | undefined,
    nettAmount?: number,
): string {
    if (!channel) return '';
    if (typeof nettAmount === 'number' && nettAmount > 0) {
        const fee = calculateChannelFee(channel, nettAmount);
        return fee > 0 ? `+ ${rupiahFormatter.format(fee)}` : 'Gratis Biaya';
    }
    const feeCustomer = channel.fee_customer || channel.total_fee;
    if (!feeCustomer) return '';
    const flat = Number(feeCustomer.flat ?? 0);
    const percent = Number(feeCustomer.percent ?? 0);
    if (flat > 0 && percent > 0) {
        return `${rupiahFormatter.format(flat)} + ${percent}%`;
    }
    if (flat > 0) {
        return rupiahFormatter.format(flat);
    }
    if (percent > 0) {
        return `${percent}%`;
    }
    return 'Gratis Biaya';
}

interface PaymentMethodSelectorProps {
    selectedChannel: string;
    onChannelChange: (channel: string) => void;
    onChannelSelect?: (channel: SupportedBank | null) => void;
    amount?: number;
    className?: string;
}

export const DEFAULT_BANKS: SupportedBank[] = [
    {
        code: 'QRIS',
        name: 'QRIS (Customizable)',
        bank_code: 'QRIS',
        bank_name: 'QRIS (Customizable)',
        group: 'E-Wallet',
        fee_customer: { flat: 750, percent: 0.7 },
    },
    {
        code: 'MANDIRIVA',
        name: 'Mandiri Virtual Account',
        bank_code: 'MANDIRIVA',
        bank_name: 'Mandiri Virtual Account',
        group: 'Virtual Account',
        fee_customer: { flat: 4250, percent: 0 },
    },
    {
        code: 'BRIVA',
        name: 'BRI Virtual Account',
        bank_code: 'BRIVA',
        bank_name: 'BRI Virtual Account',
        group: 'Virtual Account',
        fee_customer: { flat: 4250, percent: 0 },
    },
    {
        code: 'BNIVA',
        name: 'BNI Virtual Account',
        bank_code: 'BNIVA',
        bank_name: 'BNI Virtual Account',
        group: 'Virtual Account',
        fee_customer: { flat: 4250, percent: 0 },
    },
    {
        code: 'BCAVA',
        name: 'BCA Virtual Account',
        bank_code: 'BCAVA',
        bank_name: 'BCA Virtual Account',
        group: 'Virtual Account',
        fee_customer: { flat: 5500, percent: 0 },
    },
    {
        code: 'BSIVA',
        name: 'BSI Virtual Account',
        bank_code: 'BSIVA',
        bank_name: 'BSI Virtual Account',
        group: 'Virtual Account',
        fee_customer: { flat: 4250, percent: 0 },
    },
    {
        code: 'CIMBVA',
        name: 'CIMB Niaga Virtual Account',
        bank_code: 'CIMBVA',
        bank_name: 'CIMB Niaga Virtual Account',
        group: 'Virtual Account',
        fee_customer: { flat: 4250, percent: 0 },
    },
    {
        code: 'PERMATAVA',
        name: 'Permata Virtual Account',
        bank_code: 'PERMATAVA',
        bank_name: 'Permata Virtual Account',
        group: 'Virtual Account',
        fee_customer: { flat: 4250, percent: 0 },
    },
];

export default function PaymentMethodSelector({
    selectedChannel,
    onChannelChange,
    onChannelSelect,
    amount,
    className = '',
}: PaymentMethodSelectorProps) {
    const normalizedSelected = (selectedChannel || 'QRIS').toUpperCase().trim();
    const isQris = !selectedChannel || normalizedSelected.includes('QRIS');
    const isVa = !isQris;

    const [banks, setBanks] = useState<SupportedBank[]>(DEFAULT_BANKS);

    const qrisChannelObj = useMemo(() => {
        return (
            banks.find((b) => (b.code || b.bank_code || '').toUpperCase() === normalizedSelected && normalizedSelected.includes('QRIS')) ||
            banks.find((b) => (b.code || b.bank_code || '').toUpperCase().includes('QRIS')) ||
            DEFAULT_BANKS[0]
        );
    }, [banks, normalizedSelected]);

    const vaBanks = useMemo(() => {
        const filtered = banks.filter((b) => !(b.code || b.bank_code || '').toUpperCase().includes('QRIS'));
        return filtered.length > 0 ? filtered : DEFAULT_BANKS.slice(1);
    }, [banks]);

    const [selectedBank, setSelectedBank] = useState<string>(
        isVa && selectedChannel ? selectedChannel : vaBanks[0]?.code || vaBanks[0]?.bank_code || 'MANDIRIVA',
    );
    const [showBankList, setShowBankList] = useState<boolean>(true);

    // Fetch daftar channel pembayaran aktual dari API Tripay (/payment/va-banks)
    useEffect(() => {
        let isMounted = true;
        axios
            .get('/payment/va-banks')
            .then((res) => {
                if (isMounted && res.data && res.data.success) {
                    const bankList = res.data.banks || res.data.data;
                    if (Array.isArray(bankList) && bankList.length > 0) {
                        setBanks(bankList);
                    }
                }
            })
            .catch(() => {
                // Fallback default sudah tersedia
            });
        return () => {
            isMounted = false;
        };
    }, []);

    // Sinkronkan objek channel terpilih ke parent
    useEffect(() => {
        if (!onChannelSelect) return;
        if (isQris) {
            onChannelSelect(qrisChannelObj);
        } else {
            const found =
                vaBanks.find((b) => (b.code || b.bank_code || '').toUpperCase() === normalizedSelected) ||
                vaBanks[0] ||
                null;
            onChannelSelect(found);
        }
    }, [isQris, normalizedSelected, qrisChannelObj, vaBanks, onChannelSelect]);

    const handleSelectMethod = (method: 'qris' | 'va') => {
        if (method === 'qris') {
            const qrisCode = qrisChannelObj?.code || qrisChannelObj?.bank_code || 'QRIS';
            onChannelChange(qrisCode);
            onChannelSelect?.(qrisChannelObj);
        } else {
            const validExisting = vaBanks.find(
                (b) => (b.code || b.bank_code || '').toUpperCase() === selectedBank.toUpperCase(),
            );
            const targetBank = validExisting || vaBanks[0];
            const bankToSet = targetBank?.code || targetBank?.bank_code || 'MANDIRIVA';
            setSelectedBank(bankToSet);
            onChannelChange(bankToSet);
            onChannelSelect?.(targetBank || null);
            setShowBankList(true);
        }
    };

    const handleSelectBank = (bankCode: string) => {
        setSelectedBank(bankCode);
        onChannelChange(bankCode);
        const found =
            vaBanks.find((b) => (b.code || b.bank_code || '').toUpperCase() === bankCode.toUpperCase()) || null;
        onChannelSelect?.(found);
    };

    const currentBankObj =
        vaBanks.find((b) => (b.bank_code || b.code || '').toUpperCase() === selectedBank.toUpperCase()) || vaBanks[0];

    const qrisFeeLabel = formatChannelFeeDescription(qrisChannelObj, amount);

    return (
        <div className={`space-y-3.5 ${className}`}>
            <div className="flex items-center justify-between">
                <Label className="text-sm font-bold text-foreground">Metode Pembayaran</Label>
                <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Pembayaran Aman
                </span>
            </div>

            {/* Method Cards - Stacked Vertically to prevent narrow sidebar squishing/offset */}
            <div className="space-y-2.5">
                {/* 1. QRIS Card */}
                <div
                    onClick={() => handleSelectMethod('qris')}
                    role="button"
                    tabIndex={0}
                    className={`group relative flex cursor-pointer items-center justify-between rounded-xl border-2 p-3 sm:p-3.5 transition-all duration-200 select-none ${
                        isQris
                            ? 'border-orange-500 bg-orange-50/70 dark:border-orange-500 dark:bg-orange-950/20 shadow-xs'
                            : 'border-border/70 bg-card hover:border-orange-300 dark:hover:border-orange-800'
                    }`}
                >
                    <div className="flex min-w-0 items-center gap-3">
                        <BankLogo
                            bankCode={qrisChannelObj?.code || qrisChannelObj?.bank_code || 'QRIS'}
                            iconUrl={qrisChannelObj?.icon_url}
                            size="md"
                            className="shrink-0"
                        />
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-sm text-foreground">
                                    {qrisChannelObj?.name || 'QRIS'}
                                </span>
                                <Badge
                                    variant="outline"
                                    className="border-emerald-300 bg-emerald-50 text-[10px] text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 py-0 px-1.5 font-bold"
                                >
                                    Instan
                                </Badge>
                                {qrisFeeLabel && (
                                    <span className="text-[10px] font-semibold text-muted-foreground">
                                        ({qrisFeeLabel})
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                                GoPay, BCA, Mandiri, OVO, Dana, ShopeePay
                            </p>
                        </div>
                    </div>

                    <div
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all ml-2 ${
                            isQris
                                ? 'border-orange-500 bg-orange-500 text-white shadow-xs'
                                : 'border-muted-foreground/30'
                        }`}
                    >
                        {isQris && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                </div>

                {/* 2. Virtual Account Card */}
                <div
                    onClick={() => handleSelectMethod('va')}
                    role="button"
                    tabIndex={0}
                    className={`group relative flex cursor-pointer items-center justify-between rounded-xl border-2 p-3 sm:p-3.5 transition-all duration-200 select-none ${
                        isVa
                            ? 'border-orange-500 bg-orange-50/70 dark:border-orange-500 dark:bg-orange-950/20 shadow-xs'
                            : 'border-border/70 bg-card hover:border-orange-300 dark:hover:border-orange-800'
                    }`}
                >
                    <div className="flex min-w-0 items-center gap-3">
                        {isVa && currentBankObj ? (
                            <BankLogo
                                bankCode={currentBankObj.bank_code || currentBankObj.code || 'MANDIRIVA'}
                                iconUrl={currentBankObj.icon_url}
                                size="md"
                                className="shrink-0"
                            />
                        ) : (
                            <div className="flex h-7 w-12 items-center justify-center rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0">
                                <Building2 className="h-4 w-4" />
                            </div>
                        )}
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-sm text-foreground">Virtual Account / Channel Lain</span>
                                <Badge
                                    variant="outline"
                                    className="border-blue-300 bg-blue-50 text-[10px] text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 py-0 px-1.5 font-bold"
                                >
                                    Verifikasi Otomatis
                                </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                                {isVa && currentBankObj
                                    ? `${currentBankObj.bank_name || currentBankObj.name} (${formatChannelFeeDescription(currentBankObj, amount)})`
                                    : 'Mandiri, BRI, BNI, BCA, BSI, CIMB Niaga, Permata'}
                            </p>
                        </div>
                    </div>

                    <div
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all ml-2 ${
                            isVa
                                ? 'border-orange-500 bg-orange-500 text-white shadow-xs'
                                : 'border-muted-foreground/30'
                        }`}
                    >
                        {isVa && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                </div>
            </div>

            {/* Bank Selector List (shown when VA is active) */}
            {isVa && (
                <div className="rounded-xl border border-border/80 bg-muted/20 p-3 sm:p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between pb-1 border-b border-border/50">
                        <div className="flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5 text-orange-600" />
                            <span className="text-xs font-bold text-foreground">Pilih Channel Pembayaran</span>
                        </div>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowBankList(!showBankList);
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-600 hover:text-orange-700 dark:text-orange-400"
                        >
                            <span>{showBankList ? 'Tutup Pilihan' : 'Ganti Channel'}</span>
                            {showBankList ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                    </div>

                    {showBankList && (
                        <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-0.5 scrollbar-thin">
                            {vaBanks.map((bank) => {
                                const bankCode = bank.bank_code || bank.code || '';
                                const bankName = bank.bank_name || bank.name || bankCode;
                                const isBankSelected = selectedBank.toUpperCase() === bankCode.toUpperCase();
                                const feeLabel = formatChannelFeeDescription(bank, amount);

                                return (
                                    <div
                                        key={bankCode}
                                        onClick={() => handleSelectBank(bankCode)}
                                        role="button"
                                        tabIndex={0}
                                        className={`flex cursor-pointer items-center justify-between rounded-lg border p-2.5 transition-all select-none ${
                                            isBankSelected
                                                ? 'border-orange-500 bg-orange-500/10 dark:border-orange-500 dark:bg-orange-950/40 text-foreground font-semibold shadow-2xs'
                                                : 'border-border/60 bg-card hover:border-orange-300 dark:hover:border-orange-800 text-foreground'
                                        }`}
                                    >
                                        <div className="flex min-w-0 items-center gap-2.5">
                                            <BankLogo
                                                bankCode={bankCode}
                                                iconUrl={bank.icon_url}
                                                size="sm"
                                                className="shrink-0"
                                            />
                                            <div className="min-w-0">
                                                <div className="text-xs font-semibold text-foreground truncate">{bankName}</div>
                                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                                    <span className="font-mono">Kode: {bankCode}</span>
                                                    {feeLabel && (
                                                        <span className="font-semibold text-orange-600 dark:text-orange-400">
                                                            • Biaya: {feeLabel}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div
                                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all ml-2 ${
                                                isBankSelected
                                                    ? 'border-orange-500 bg-orange-500 text-white'
                                                    : 'border-muted-foreground/30'
                                            }`}
                                        >
                                            {isBankSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
