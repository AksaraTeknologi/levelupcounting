import axios from 'axios';
import PaymentChannelSelector, { CalculatedFeeData } from '@/components/payment-channel-selector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { rupiahFormatter } from '@/lib/utils';
import { SharedData } from '@/types';
import { usePage } from '@inertiajs/react';
import { format, parseISO } from 'date-fns';
import { enUS, id } from 'date-fns/locale';
import { AlertCircle, CheckCircle2, Clock, CreditCard, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

export interface InstallmentTermOption {
    term_number: number;
    amount: number;
    due_date?: string | null;
    due_days?: number | null;
}

export interface ActiveInstallmentTerm {
    id: string;
    term_number: number;
    amount: number;
    nett_amount?: number;
    due_date: string | null;
    status: string;
    paid_at: string | null;
}

export interface ActiveInstallmentData {
    parent_invoice_id: string;
    invoice_code: string;
    status: string;
    amount: number;
    nett_amount?: number;
    total_terms: number;
    paid_terms: number;
    is_fully_paid: boolean;
    next_term: {
        id: string;
        term_number: number;
        amount: number;
        nett_amount?: number;
        due_date: string | null;
        is_overdue: boolean;
    } | null;
    terms: ActiveInstallmentTerm[];
}

interface InstallmentOptionsProps {
    productType: string;
    productId: string;
    productPrice: number;
    terms: InstallmentTermOption[];
    activeInstallment?: ActiveInstallmentData | null;
    termsAccepted?: boolean;
    onTermsAcceptedChange?: (accepted: boolean) => void;
    onBeforePay?: () => Promise<boolean> | boolean;
}

export default function InstallmentOptions({
    productType,
    productId,
    terms,
    activeInstallment,
    termsAccepted,
    onTermsAcceptedChange,
    onBeforePay,
}: InstallmentOptionsProps) {
    const { t, i18n } = useTranslation('common');
    const { auth } = usePage<SharedData>().props;
    const isLoggedIn = !!auth?.user;
    const isGuestBlocked = !isLoggedIn && !onBeforePay;
    const isCourse = productType === 'course';
    const dateLocale = i18n.language === 'en' ? enUS : id;
    const [isLoading, setIsLoading] = useState(false);
    const [selectedChannel, setSelectedChannel] = useState<string>('');
    const [calculatedFee, setCalculatedFee] = useState<CalculatedFeeData | null>(null);
    const [, setFeeError] = useState<string | null>(null);

    const hasActiveInstallment = !!activeInstallment && activeInstallment.terms?.length > 0;
    const isTermOverdueCheck = (dueDateStr?: string | null) => {
        if (!dueDateStr) return false;
        try {
            const d = typeof dueDateStr === 'string' ? parseISO(dueDateStr) : new Date(dueDateStr);
            if (isNaN(d.getTime())) return false;
            const endOfDay = new Date(d);
            endOfDay.setHours(23, 59, 59, 999);
            return new Date() > endOfDay;
        } catch {
            return false;
        }
    };

    const isAnyTermOverdue = !isCourse && !hasActiveInstallment && terms.some((t) => isTermOverdueCheck(t.due_date));
    const isFullyPaid = hasActiveInstallment && activeInstallment.is_fully_paid;
    const nextTerm = hasActiveInstallment ? activeInstallment.next_term : null;

    const baseDpAmount = Number(terms[0]?.amount ?? 0);
    const dpFee = calculatedFee ? calculatedFee.fee_customer : 0;
    const dpAmount = baseDpAmount > 0 ? baseDpAmount + dpFee : 0;

    const baseTotalAmount = terms.reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const totalAmount = baseTotalAmount + dpFee;

    const remainingAmount = hasActiveInstallment
        ? activeInstallment.terms.filter((t) => t.status !== 'paid').reduce((sum, t) => sum + Number(t.amount || 0), 0)
        : totalAmount;

    async function handlePayNextTerm() {
        if (!activeInstallment || !nextTerm) return;

        setIsLoading(true);
        try {
            if (onBeforePay) {
                const canProceed = await onBeforePay();
                if (!canProceed) {
                    setIsLoading(false);
                    return;
                }
            }

            const csrfToken = (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement | null)?.content || '';
            const res = await axios.post(
                `/installment/${activeInstallment.parent_invoice_id}/pay`,
                {
                    payment_channel: selectedChannel,
                },
                {
                    headers: {
                        'X-CSRF-TOKEN': csrfToken,
                    },
                },
            );

            if (res.data.success && res.data.payment_url) {
                window.location.href = res.data.payment_url;
            } else {
                toast.error(res.data.message || t('installmentOptions.errors.failProcessTerm', 'Gagal memproses pembayaran termin'));
                setIsLoading(false);
            }
        } catch (error: any) {
            setIsLoading(false);
            if (error.response?.status === 401) {
                toast.error(t('installmentOptions.errors.loginOrFillData', 'Silakan lengkapi data diri atau masuk terlebih dahulu.'));
            } else if (error.response?.status === 419) {
                toast.error(t('installmentOptions.errors.sessionExpired', 'Sesi telah kedaluwarsa.'));
            } else {
                toast.error(error.response?.data?.message || t('installmentOptions.errors.errorProcessTerm', 'Terjadi kesalahan saat memproses pembayaran termin.'));
            }
        }
    }

    async function handleRegisterInstallment() {
        if (isGuestBlocked) {
            toast.error(t('installmentOptions.errors.loginOrFillData', 'Silakan lengkapi data diri atau masuk terlebih dahulu.'));
            const currentUrl = encodeURIComponent(window.location.href);
            setTimeout(() => {
                window.location.href = `/login?redirect=${currentUrl}`;
            }, 800);
            return;
        }

        if (!selectedChannel) {
            toast.error(t('installmentOptions.errors.selectPaymentMethod', 'Silakan pilih metode pembayaran terlebih dahulu.'));
            return;
        }

        if (termsAccepted !== undefined && !termsAccepted) {
            toast.error(t('installmentOptions.errors.acceptTerms', 'Silakan setujui syarat dan ketentuan terlebih dahulu.'));
            return;
        }

        setIsLoading(true);
        try {
            if (onBeforePay) {
                const canProceed = await onBeforePay();
                if (!canProceed) {
                    setIsLoading(false);
                    return;
                }
            }

            const payload: Record<string, unknown> = {
                type: productType,
                id: productId,
                payment_channel: selectedChannel,
                payment_method: selectedChannel,
            };

            const csrfToken = (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement | null)?.content || '';
            const res = await axios.post('/invoice/installment', payload, {
                headers: {
                    'X-CSRF-TOKEN': csrfToken,
                },
            });

            if (res.data.success && res.data.payment_url) {
                window.location.href = res.data.payment_url;
            } else {
                toast.error(res.data.message || t('installmentOptions.errors.failCreateBill', 'Gagal membuat tagihan cicilan'));
                setIsLoading(false);
            }
        } catch (error: any) {
            setIsLoading(false);
            if (error.response?.status === 401) {
                toast.error(t('installmentOptions.errors.loginOrFillData', 'Silakan lengkapi data diri atau masuk terlebih dahulu.'));
            } else if (error.response?.status === 419) {
                toast.error(t('installmentOptions.errors.sessionExpired', 'Sesi telah kedaluwarsa.'));
            } else {
                toast.error(error.response?.data?.message || t('installmentOptions.errors.errorProcessInstallment', 'Terjadi kesalahan saat memproses pembayaran cicilan.'));
            }
        }
    }

    if (terms.length === 0 && !hasActiveInstallment) return null;

    // JIKA CICILAN SUDAH LUNAS 100%
    if (isFullyPaid) {
        return (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-xs text-green-900 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-300">
                <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                    {t('installmentOptions.fullyPaid.title', 'Cicilan Lunas')}
                </div>
                <p className="mt-1 opacity-90">
                    {t('installmentOptions.fullyPaid.desc', 'Cicilan Anda untuk program ini sudah lunas! Akses materi sudah aktif sepenuhnya.')}
                </p>
                <Button variant="outline" size="sm" asChild className="mt-3 bg-white dark:bg-background text-green-800 border-green-300">
                    <a href="/profile/installments">{t('installmentOptions.fullyPaid.historyButton', 'Lihat Riwayat Cicilan')}</a>
                </Button>
            </div>
        );
    }

    // JIKA USER SUDAH PUNYA CICILAN AKTIF
    if (hasActiveInstallment && nextTerm) {
        return (
            <div className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-900 dark:text-blue-300">
                            <Clock className="h-4 w-4" />
                            {t('installmentOptions.active.title', 'Cicilan Aktif')}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            {t('installmentOptions.active.invoiceCode', 'Invoice:')} <span className="font-mono font-medium text-foreground">{activeInstallment.invoice_code}</span>
                        </p>
                    </div>
                    <Badge variant="outline" className="border-blue-300 bg-blue-100/60 text-blue-800 dark:border-blue-800 dark:bg-blue-900/50 dark:text-blue-300">
                        {activeInstallment.paid_terms}/{activeInstallment.total_terms} {t('installmentOptions.active.termsPaid', 'Termin Dibayar')}
                    </Badge>
                </div>

                <div className="space-y-1.5 rounded-lg border border-border bg-card p-3 text-xs">
                    <div className="flex justify-between text-muted-foreground">
                        <span>{t('installmentOptions.active.nextBill', 'Tagihan Berikutnya:')}</span>
                        <span className="font-medium text-foreground">
                            {t('installmentOptions.active.termNumber', { number: nextTerm.term_number, defaultValue: `Termin ke-${nextTerm.term_number}` })}
                        </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                        <span>{t('installmentOptions.active.nominal', 'Nominal:')}</span>
                        <span className="font-bold text-foreground">
                            {rupiahFormatter.format(Number(nextTerm.amount || 0))}
                        </span>
                    </div>
                    {nextTerm.due_date && (
                        <div className="flex justify-between text-muted-foreground">
                            <span>{t('installmentOptions.active.dueDate', 'Jatuh Tempo:')}</span>
                            <span className={nextTerm.is_overdue ? 'font-semibold text-destructive' : 'font-medium text-foreground'}>
                                {format(parseISO(nextTerm.due_date), 'dd MMMM yyyy', { locale: dateLocale })}
                                {nextTerm.is_overdue && ` (${t('installmentOptions.active.overdue', 'Terlewat')})`}
                            </span>
                        </div>
                    )}
                    <div className="flex justify-between border-t border-border pt-1.5 text-muted-foreground">
                        <span>{t('installmentOptions.active.remainingBill', 'Sisa Total Tagihan:')}</span>
                        <span className="font-semibold text-foreground">{rupiahFormatter.format(remainingAmount)}</span>
                    </div>
                </div>

                {nextTerm.is_overdue && (
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <div>
                            <span className="font-semibold">{t('installmentOptions.active.overdueAlertTitle', 'Cicilan Melewati Jatuh Tempo')}</span>
                            <p className="mt-0.5 opacity-90">
                                {t('installmentOptions.active.overdueAlertDesc', 'Batas waktu pembayaran telah terlewati. Pembayaran mandiri ditutup. Silakan hubungi admin untuk penyelesaian cicilan.')}
                            </p>
                        </div>
                    </div>
                )}

                <div className="flex gap-2">
                    {!nextTerm.is_overdue ? (
                        <Button
                            className="w-full bg-[#1d52a2] hover:bg-[#164080] text-white"
                            onClick={handlePayNextTerm}
                            disabled={isLoading}
                        >
                            <CreditCard className="mr-2 h-4 w-4" />
                            {isLoading ? t('installmentOptions.active.processing', 'Memproses...') : t('installmentOptions.active.payNow', { number: nextTerm.term_number, defaultValue: `Bayar Termin ke-${nextTerm.term_number}` })}
                        </Button>
                    ) : (
                        <Button
                            className="w-full"
                            variant="destructive"
                            asChild
                        >
                            <a href="https://wa.me/6281250031744" target="_blank" rel="noopener noreferrer">
                                {t('installmentOptions.active.contactAdmin', 'Hubungi Admin via WhatsApp')}
                            </a>
                        </Button>
                    )}
                    <Button variant="outline" asChild>
                        <a href="/profile/installments">{t('installmentOptions.active.allHistory', 'Semua Riwayat')}</a>
                    </Button>
                </div>
            </div>
        );
    }

    // JIKA USER BARU DAFTAR CICILAN
    return (
        <div className="space-y-4">
            {/* Banner login terlebih dahulu untuk guest apabila checkout mewajibkan login */}
            {isGuestBlocked && (
                <div className="rounded-lg bg-blue-50 border border-blue-200 p-3.5 text-xs text-blue-900 dark:bg-blue-950/30 dark:border-blue-900 dark:text-blue-200 flex items-start gap-2.5">
                    <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <div className="space-y-1">
                        <p className="font-semibold">{t('installmentOptions.loginRequiredTitle', 'Login Diperlukan untuk Cicilan')}</p>
                        <p className="opacity-90 leading-relaxed">
                            {t('installmentOptions.errors.loginOrFillData', 'Silakan lengkapi data diri atau masuk terlebih dahulu.')}{' '}
                            <a
                                href={`/login?redirect=${encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '')}`}
                                className="font-semibold underline hover:text-blue-700"
                            >
                                {t('installmentOptions.loginNowLink', 'Masuk Sekarang')}
                            </a>
                        </p>
                    </div>
                </div>
            )}

            {/* Banner Overdue / Cicilan Ditutup */}
            {isAnyTermOverdue && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                    <div>
                        <span className="font-semibold">{t('installmentOptions.register.closedTitle', 'Cicilan Ditutup')}</span>
                        <p className="mt-0.5 opacity-90">
                            {t('installmentOptions.register.closedDesc', 'Opsi pembayaran cicilan untuk program ini telah ditutup karena batas waktu pembayaran telah terlewati.')}
                        </p>
                    </div>
                </div>
            )}

            {/* Total cicilan badge */}
            <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900/50 dark:bg-blue-950/30">
                <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span className="text-xs font-semibold text-blue-900 dark:text-blue-300">
                        {t('installmentOptions.register.programCicilan', 'Program Cicilan Tersedia')}
                    </span>
                </div>
                <div className="text-right">
                    <span className="text-xs font-bold text-blue-900 dark:text-blue-300">
                        {rupiahFormatter.format(totalAmount)}
                    </span>
                    <p className="text-[11px] text-muted-foreground">
                        {t('installmentOptions.register.termsCount', { count: terms.length, defaultValue: `${terms.length}x Termin Cicilan` })}
                    </p>
                </div>
            </div>

            {/* Jadwal Pembayaran */}
            <div className="space-y-2.5 rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between pb-1 border-b border-border">
                    <span className="text-xs font-semibold text-foreground">
                        {t('installmentOptions.register.scheduleTitle', 'Jadwal Pembayaran Cicilan')}
                    </span>
                    <Badge variant="outline" className="text-[11px] bg-primary/10 text-primary border-primary/20">
                        {terms.length}x {t('installmentOptions.register.termsLabel', 'Termin')}
                    </Badge>
                </div>

                <div className="space-y-2 pt-1">
                    {terms.map((term, i) => {
                        const termAmountFormatted = rupiahFormatter.format(term.amount);
                        return (
                            <div key={i} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 p-2.5 text-xs">
                                <div className="flex items-center gap-2.5">
                                    <div className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/20 text-muted-foreground'}`}>
                                        {term.term_number}
                                    </div>
                                    <div>
                                        <p className="font-medium text-foreground">
                                            {i === 0 ? t('installmentOptions.register.dpLabel', 'Termin 1 (DP)') : t('installmentOptions.register.termNumberLabel', { number: term.term_number, defaultValue: `Termin ke-${term.term_number}` })}
                                        </p>
                                        <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                            <Clock className="h-3 w-3" />
                                            {isCourse && term.due_days
                                                ? t('installmentOptions.dueDaysLabel', {
                                                      days: term.due_days,
                                                      defaultValue: `H+${term.due_days} setelah pembelian`,
                                                  })
                                                : term.due_date
                                                  ? format(parseISO(term.due_date), 'dd MMMM yyyy', { locale: dateLocale })
                                                  : '-'}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                    <span className="font-semibold text-foreground">
                                        {i === 0 ? rupiahFormatter.format(dpAmount) : termAmountFormatted}
                                    </span>
                                    {i === 0 && dpFee > 0 && (
                                        <p className="text-[10px] text-muted-foreground">
                                            {t('installmentOptions.register.includingTripayFee', 'Termasuk Biaya Transaksi')}
                                        </p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Ketentuan Cicilan */}
            <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-1.5 text-xs text-muted-foreground">
                <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                    <span>{t('installmentOptions.register.termsNoteFee', 'Biaya transaksi disesuaikan dengan metode pembayaran Tripay yang dipilih.')}</span>
                </div>
                <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                    <span>{t('installmentOptions.register.termsNoteActive', 'Akses materi/program langsung aktif segera setelah DP dibayar.')}</span>
                </div>
                <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                    <span>{t('installmentOptions.register.termsNotePromo', 'Voucher promo dan poin reward tidak dapat digunakan pada pembayaran cicilan.')}</span>
                </div>
                <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    <span>{t('installmentOptions.register.termsNoteSuspend', 'Akses akan ditangguhkan jika cicilan melewati tanggal jatuh tempo.')}</span>
                </div>
            </div>

            {/* Pilihan Metode Pembayaran Tripay */}
            <PaymentChannelSelector
                selectedChannel={selectedChannel}
                onSelectChannel={setSelectedChannel}
                amount={baseDpAmount}
                onFeeCalculated={(feeData, err) => {
                    setCalculatedFee(feeData);
                    setFeeError(err);
                }}
            />

            {/* Checkbox Syarat & Ketentuan */}
            {onTermsAcceptedChange && (
                <div className="flex items-center gap-3 pt-1">
                    <Checkbox
                        disabled={isAnyTermOverdue}
                        id="installment-terms-checkbox"
                        checked={termsAccepted}
                        onCheckedChange={(checked) => onTermsAcceptedChange(checked === true)}
                    />
                    <Label htmlFor="installment-terms-checkbox" className="text-xs cursor-pointer">
                        {t('installmentOptions.register.agreeToTerms', 'Saya menyetujui')}{' '}
                        <a
                            href="/terms-and-conditions"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                        >
                            {t('installmentOptions.register.termsLink', 'syarat dan ketentuan cicilan')}
                        </a>
                    </Label>
                </div>
            )}

            {/* Tombol Bayar DP Cicilan */}
            <Button
                type="button"
                id="btn-pay-installment"
                className="w-full bg-[#1d52a2] hover:bg-[#164080] text-white py-6 text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                onClick={handleRegisterInstallment}
                disabled={isLoading || isAnyTermOverdue || isGuestBlocked || (termsAccepted !== undefined && !termsAccepted) || !selectedChannel}
            >
                <CreditCard className="mr-2 h-4 w-4" />
                {isGuestBlocked
                    ? t('installmentOptions.loginRequiredBtn', 'Login untuk Bayar Cicilan')
                    : isAnyTermOverdue
                      ? t('installmentOptions.btnClosed', 'Opsi Cicilan Ditutup (Batas Waktu Terlewat)')
                      : isLoading
                        ? t('installmentOptions.register.processing', 'Memproses...')
                        : t('installmentOptions.register.payDpButton', {
                              amount: rupiahFormatter.format(dpAmount),
                              defaultValue: `Bayar DP (${rupiahFormatter.format(dpAmount)}) & Aktifkan Program`,
                          })}
            </Button>
        </div>
    );
}
