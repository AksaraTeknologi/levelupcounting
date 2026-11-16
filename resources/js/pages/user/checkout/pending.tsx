import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import UserLayout from '@/layouts/user-layout';
import { Head, Link, router } from '@inertiajs/react';
import axios from 'axios';
import { motion } from 'framer-motion';
import {
    AlertCircle,
    ArrowRight,
    Building2,
    Check,
    CheckCircle2,
    Clock,
    Copy,
    Download,
    ExternalLink,
    Hourglass,
    QrCode,
    RefreshCw,
    ShieldCheck,
    XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import BankLogo from '@/components/bank-logo';

interface CourseItem {
    course: { title: string; slug: string; thumbnail?: string };
}
interface BootcampItem {
    bootcamp: { title: string; slug: string; thumbnail?: string };
}
interface WebinarItem {
    webinar: { title: string; slug: string; thumbnail?: string };
}
interface CertificationProgramItem {
    certification_program: { title: string; slug: string; thumbnail?: string };
}
interface BundleItem {
    bundle: { title: string; slug: string; thumbnail?: string };
}

interface Invoice {
    id: string;
    invoice_code: string;
    invoice_url?: string | null;
    amount: number;
    nett_amount: number;
    transaction_fee: number;
    status: 'pending' | 'paid' | 'failed' | 'installment_pending' | string;
    payment_method?: string;
    payment_channel?: string;
    payment_reference?: string;
    va_number?: string;
    qr_code_url?: string;
    created_at?: string;
    expires_at?: string;
    paid_at?: string;
    course_items?: CourseItem[];
    bootcamp_items?: BootcampItem[];
    webinar_items?: WebinarItem[];
    certification_program_items?: CertificationProgramItem[];
    bundle_enrollments?: BundleItem[];
}

interface PaymentInstructionGroup {
    title: string;
    steps: string[];
}

interface PendingProps {
    invoice: Invoice;
    paymentInstructions?: PaymentInstructionGroup[];
    transactionDetail?: Record<string, any> | null;
    simulatorUrl?: string;
    isSandbox?: boolean;
}

export default function CheckoutPending({
    invoice,
    paymentInstructions = [],
    transactionDetail = null,
    simulatorUrl = 'https://tripay.co.id/simulator',
    isSandbox = true,
}: PendingProps) {
    const [timeLeft, setTimeLeft] = useState<string>('');
    const [isExpired, setIsExpired] = useState<boolean>(false);
    const [copiedVa, setCopiedVa] = useState<boolean>(false);
    const [copiedAmount, setCopiedAmount] = useState<boolean>(false);
    const [isCancelling, setIsCancelling] = useState<boolean>(false);
    const [isChecking, setIsChecking] = useState<boolean>(false);

    // Hitung countdown expiry
    useEffect(() => {
        if (!invoice.expires_at || invoice.status !== 'pending') return;

        const updateTimer = () => {
            const diff = new Date(invoice.expires_at!).getTime() - new Date().getTime();
            if (diff <= 0) {
                setTimeLeft('00:00:00');
                setIsExpired(true);
                return;
            }

            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            const pad = (n: number) => n.toString().padStart(2, '0');
            setTimeLeft(`${pad(hours)}:${pad(minutes)}:${pad(seconds)}`);
        };

        updateTimer();
        const interval = setInterval(updateTimer, 1000);
        return () => clearInterval(interval);
    }, [invoice.expires_at, invoice.status]);

    const isPaid = invoice.status === 'paid';
    const isFailed = invoice.status === 'failed';
    const isOverdue = isExpired && invoice.status === 'pending';

    const channelUpper = (invoice.payment_channel || '').toUpperCase();
    const isQris = channelUpper === '' || channelUpper.includes('QRIS');
    const isVa = !isQris;

    const copyToClipboard = (text: string, type: 'va' | 'amount') => {
        navigator.clipboard.writeText(text);
        if (type === 'va') {
            setCopiedVa(true);
            setTimeout(() => setCopiedVa(false), 2000);
            toast.success('Nomor / Kode Pembayaran berhasil disalin');
        } else {
            setCopiedAmount(true);
            setTimeout(() => setCopiedAmount(false), 2000);
            toast.success('Nominal pembayaran berhasil disalin');
        }
    };

    const handleCheckStatus = () => {
        setIsChecking(true);
        router.reload({
            onFinish: () => {
                setIsChecking(false);
                toast.info('Status pembayaran diperbarui');
            },
        });
    };

    const handleCancelInvoice = async () => {
        if (!confirm('Apakah Anda yakin ingin membatalkan tagihan pembayaran ini?')) return;
        setIsCancelling(true);
        try {
            await axios.post(route('invoice.cancel', invoice.id));
            toast.success('Tagihan berhasil dibatalkan');
            router.reload();
        } catch (err: any) {
            toast.error(err.response?.data?.message || 'Gagal membatalkan tagihan');
        } finally {
            setIsCancelling(false);
        }
    };

    // Nama produk & link akses
    let productTitle = 'Tagihan Pembayaran';
    let productLink = '/profile/my-courses';
    if (invoice.course_items && invoice.course_items.length > 0) {
        productTitle = invoice.course_items[0].course.title;
        productLink = `/profile/my-courses/${invoice.course_items[0].course.slug}`;
    } else if (invoice.bootcamp_items && invoice.bootcamp_items.length > 0) {
        productTitle = invoice.bootcamp_items[0].bootcamp.title;
        productLink = `/profile/my-bootcamps/${invoice.bootcamp_items[0].bootcamp.slug}`;
    } else if (invoice.webinar_items && invoice.webinar_items.length > 0) {
        productTitle = invoice.webinar_items[0].webinar.title;
        productLink = `/profile/my-webinars/${invoice.webinar_items[0].webinar.slug}`;
    } else if (invoice.certification_program_items && invoice.certification_program_items.length > 0) {
        productTitle = invoice.certification_program_items[0].certification_program.title;
        productLink = `/profile/my-certifications`;
    } else if (invoice.bundle_enrollments && invoice.bundle_enrollments.length > 0) {
        productTitle = invoice.bundle_enrollments[0].bundle.title;
        productLink = `/profile/my-courses`;
    }

    const bankNameMap: Record<string, string> = {
        BMRI: 'Bank Mandiri',
        MANDIRIVA: 'Bank Mandiri',
        BNIA: 'Bank CIMB Niaga',
        CIMBVA: 'Bank CIMB Niaga',
        BBBA: 'Bank Permata',
        PERMATAVA: 'Bank Permata',
        BRIN: 'Bank Rakyat Indonesia (BRI)',
        BRIVA: 'Bank Rakyat Indonesia (BRI)',
        BSYI: 'Bank Syariah Indonesia (BSI)',
        BSIVA: 'Bank Syariah Indonesia (BSI)',
        BNIVA: 'Bank BNI',
        BCAVA: 'Bank BCA',
        MANDIRI: 'Bank Mandiri',
        CIMB: 'Bank CIMB Niaga',
        CIMB_NIAGA: 'Bank CIMB Niaga',
        PERMATA: 'Bank Permata',
        BRI: 'Bank Rakyat Indonesia (BRI)',
        BSI: 'Bank Syariah Indonesia (BSI)',
        BCA: 'Bank BCA',
        BNI: 'Bank BNI',
        QRIS: 'QRIS',
        QRISC: 'QRIS',
        QRIS2: 'QRIS',
    };

    const bankName =
        transactionDetail?.payment_name ||
        bankNameMap[channelUpper] ||
        invoice.payment_channel ||
        'Virtual Account';

    const dynamicInstructions: PaymentInstructionGroup[] =
        Array.isArray(paymentInstructions) && paymentInstructions.length > 0
            ? paymentInstructions
            : Array.isArray(transactionDetail?.instructions)
              ? transactionDetail.instructions
              : [];

    const payCodeValue = invoice.va_number || transactionDetail?.pay_code || null;
    const qrCodeSrc = invoice.qr_code_url || transactionDetail?.qr_url || null;

    const isTripay = (invoice.payment_method || '').toLowerCase() === 'tripay' || Boolean(transactionDetail);
    const hostedPaymentUrl = invoice.invoice_url || transactionDetail?.checkout_url || null;
    const paymentReference = invoice.payment_reference || transactionDetail?.reference || null;
    const tripaySimulatorUrl = simulatorUrl || 'https://tripay.co.id/simulator';

    return (
        <div className="relative min-h-screen bg-background">
            <UserLayout>
                <Head title={`${isPaid ? 'Pembayaran Berhasil' : isFailed ? 'Pembayaran Gagal' : 'Menunggu Pembayaran'} - ${invoice.invoice_code}`} />

                <div className="mx-auto max-w-4xl px-4 py-12">
                    {/* Status Header */}
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-8 text-center"
                    >
                        {isPaid ? (
                            <div className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-4 py-1.5 text-sm font-semibold text-green-700 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-300">
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                Pembayaran Berhasil Terverifikasi
                            </div>
                        ) : isFailed ? (
                            <div className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-1.5 text-sm font-semibold text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                                <XCircle className="h-4 w-4" />
                                Transaksi Dibatalkan / Gagal
                            </div>
                        ) : isOverdue ? (
                            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-sm font-semibold text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
                                <AlertCircle className="h-4 w-4" />
                                Masa Pembayaran Telah Habis
                            </div>
                        ) : (
                            <div className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-4 py-1.5 text-sm font-semibold text-orange-700 dark:border-orange-900/50 dark:bg-orange-950/40 dark:text-orange-300">
                                <Hourglass className="h-4 w-4 animate-spin text-orange-600" />
                                Menunggu Pembayaran
                            </div>
                        )}

                        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                            {isPaid
                                ? 'Pembayaran Berhasil Diterima'
                                : isFailed
                                ? 'Pembayaran Tidak Terselesaikan'
                                : isOverdue
                                ? 'Batas Waktu Pembayaran Berakhir'
                                : 'Selesaikan Pembayaran Anda'}
                        </h1>
                        <p className="mt-2 text-sm text-muted-foreground">
                            No. Invoice: <span className="font-mono font-semibold text-foreground">{invoice.invoice_code}</span>
                        </p>
                    </motion.div>

                    {/* Mode Sandbox & Simulator Banner */}
                    {!isPaid && !isFailed && !isOverdue && isSandbox && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="mb-8"
                        >
                            <Card className="overflow-hidden border-2 border-indigo-200 bg-gradient-to-r from-indigo-50/90 via-blue-50/80 to-purple-50/90 p-5 shadow-sm dark:border-indigo-900/60 dark:from-indigo-950/40 dark:via-blue-950/30 dark:to-purple-950/40">
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                    <div className="space-y-1">
                                        <div className="inline-flex items-center gap-2 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-300">
                                            <ShieldCheck className="h-3.5 w-3.5" />
                                            Mode Uji Coba Tripay Sandbox
                                        </div>
                                        <h4 className="text-base font-bold text-foreground">
                                            Gunakan Simulator Pembayaran Tripay
                                        </h4>
                                        <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
                                            Tagihan ini berada dalam environment Sandbox. Anda dapat menyelesaikan simulasi transaksi secara instan tanpa memotong dana nyata melalui portal Simulator Tripay resmi.
                                        </p>
                                    </div>
                                    <div className="flex flex-col sm:flex-row gap-2 shrink-0 w-full sm:w-auto">
                                        {hostedPaymentUrl && (
                                            <Button asChild size="sm" className="font-semibold gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
                                                <a href={hostedPaymentUrl} target="_blank" rel="noopener noreferrer">
                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                    Halaman Pembayaran Tripay
                                                </a>
                                            </Button>
                                        )}
                                        <Button asChild size="sm" className="font-semibold gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs">
                                            <a href={tripaySimulatorUrl} target="_blank" rel="noopener noreferrer">
                                                <ExternalLink className="h-3.5 w-3.5" />
                                                Buka Simulator Tripay
                                            </a>
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        </motion.div>
                    )}

                    <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
                        {/* Main Payment Section */}
                        <div className="md:col-span-2 space-y-6">
                            {/* State: Verified Paid */}
                            {isPaid && (
                                <Card className="overflow-hidden border border-green-200 bg-card p-6 shadow-md dark:border-green-900/60">
                                    <div className="flex flex-col items-center justify-center py-6 text-center">
                                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-950/60 dark:text-green-400">
                                            <ShieldCheck className="h-10 w-10" />
                                        </div>
                                        <h3 className="mt-4 text-xl font-bold text-foreground">Transaksi Sukses!</h3>
                                        <p className="mt-1 max-w-md text-sm text-muted-foreground">
                                            Pembayaran untuk tagihan <span className="font-semibold text-foreground">{invoice.invoice_code}</span> telah diverifikasi secara otomatis oleh sistem.
                                        </p>

                                        <div className="mt-6 w-full max-w-sm rounded-xl border bg-muted/30 p-4 text-left text-xs space-y-2">
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Metode Pembayaran:</span>
                                                <span className="font-semibold text-foreground uppercase">{isQris ? 'QRIS Dynamic' : `VA ${bankName}`}</span>
                                            </div>
                                            {invoice.payment_reference && (
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Nomor Referensi:</span>
                                                    <span className="font-mono font-semibold text-foreground">{invoice.payment_reference}</span>
                                                </div>
                                            )}
                                            <div className="flex justify-between pt-1 border-t">
                                                <span className="text-muted-foreground">Total Nominal:</span>
                                                <span className="font-bold text-foreground text-sm text-green-600">
                                                    Rp {(invoice.amount || 0).toLocaleString('id-ID')}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="mt-6 flex flex-col sm:flex-row gap-3 w-full max-w-sm">
                                            <Button asChild size="lg" className="w-full font-bold gap-2 bg-green-600 hover:bg-green-700 text-white">
                                                <Link href={productLink}>
                                                    Akses Materi Sekarang
                                                    <ArrowRight className="h-4 w-4" />
                                                </Link>
                                            </Button>
                                        </div>
                                    </div>
                                </Card>
                            )}

                            {/* State: QRIS Card */}
                            {!isPaid && isQris && (
                                <Card className="overflow-hidden border border-border/60 bg-card p-6 shadow-md">
                                    <div className="flex items-center justify-between border-b pb-4">
                                        <div className="flex items-center gap-3">
                                            <BankLogo bankCode={invoice.payment_channel || 'QRIS'} size="md" />
                                            <div>
                                                <h3 className="font-bold text-foreground">{bankName || 'QRIS'}</h3>
                                                <p className="text-xs text-muted-foreground">
                                                    Merchant: Level Up Counting
                                                    {invoice.payment_reference ? ` • Ref: ${invoice.payment_reference}` : ''}
                                                </p>
                                            </div>
                                        </div>
                                        {!isFailed && !isOverdue && (
                                            <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-600">
                                                <Clock className="h-4 w-4" />
                                                <span>{timeLeft || 'Memuat timer...'}</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* QR Image Display */}
                                    <div className="my-6 flex flex-col items-center justify-center">
                                        <div className="relative rounded-2xl border-2 border-border/80 bg-white p-4 shadow-sm">
                                            {qrCodeSrc ? (
                                                <img
                                                    src={qrCodeSrc}
                                                    alt="QRIS Code"
                                                    className={`h-64 w-64 object-contain ${
                                                        isOverdue || isFailed ? 'opacity-25 grayscale blur-[2px]' : ''
                                                    }`}
                                                />
                                            ) : (
                                                <div className="flex h-64 w-64 items-center justify-center text-center text-sm text-muted-foreground">
                                                    Memuat QRIS...
                                                </div>
                                            )}

                                            {(isOverdue || isFailed) && (
                                                <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-background/80 p-4 text-center">
                                                    <XCircle className="h-10 w-10 text-red-600" />
                                                    <p className="mt-2 text-sm font-bold text-red-600">
                                                        {isFailed ? 'QRIS Dibatalkan' : 'QRIS Kedaluwarsa'}
                                                    </p>
                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        Kode QR tidak dapat digunakan lagi.
                                                    </p>
                                                </div>
                                            )}
                                        </div>

                                        {isOverdue || isFailed ? (
                                            <p className="mt-3 text-center text-xs font-semibold text-red-600">
                                                Transaksi ini telah kedaluwarsa atau dibatalkan. Silakan batalkan transaksi untuk membuat pesanan baru.
                                            </p>
                                        ) : (
                                            <p className="mt-3 text-center text-xs text-muted-foreground">
                                                Scan QR di atas menggunakan aplikasi m-Banking atau E-Wallet apa pun
                                                (BCA, Mandiri, BRI, BNI, GoPay, OVO, ShopeePay, Dana, dll.)
                                            </p>
                                        )}
                                    </div>

                                    {/* Action Buttons: Tripay Hosted & Simulator */}
                                    {!isOverdue && !isFailed && (
                                        <div className="mb-6 flex flex-col sm:flex-row items-center justify-center gap-3 w-full max-w-md mx-auto">
                                            {hostedPaymentUrl && (
                                                <Button asChild size="lg" className="w-full sm:flex-1 font-bold gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
                                                    <a href={hostedPaymentUrl} target="_blank" rel="noopener noreferrer">
                                                        <ExternalLink className="h-4 w-4" />
                                                        Buka Halaman Tripay
                                                    </a>
                                                </Button>
                                            )}
                                            {isSandbox && (
                                                <Button asChild variant="outline" size="lg" className="w-full sm:flex-1 font-bold gap-2 border-indigo-400 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300">
                                                    <a href={tripaySimulatorUrl} target="_blank" rel="noopener noreferrer">
                                                        <ExternalLink className="h-4 w-4" />
                                                        Bayar via Simulator
                                                    </a>
                                                </Button>
                                            )}
                                        </div>
                                    )}

                                    {/* Simulator Guide for QRIS */}
                                    {!isPaid && !isFailed && !isOverdue && isSandbox && (
                                        <div className="mb-6 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-xs space-y-2 text-indigo-950 dark:border-indigo-900/40 dark:bg-indigo-950/20 dark:text-indigo-200">
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold flex items-center gap-1.5">
                                                    <CheckCircle2 className="h-4 w-4 text-indigo-600" />
                                                    Langkah Bayar via Simulator Tripay (QRIS):
                                                </span>
                                                <a
                                                    href={tripaySimulatorUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="font-semibold underline text-indigo-700 hover:text-indigo-800 dark:text-indigo-300 flex items-center gap-1"
                                                >
                                                    Buka Simulator <ExternalLink className="h-3 w-3" />
                                                </a>
                                            </div>
                                            <ol className="list-inside list-decimal space-y-1 text-muted-foreground dark:text-indigo-300/80">
                                                <li>Klik tombol <strong>Bayar via Simulator</strong> di atas untuk membuka simulator Tripay.</li>
                                                <li>Pilih tab <strong>QRIS</strong> pada halaman simulator.</li>
                                                {paymentReference && (
                                                    <li>
                                                        Masukkan Kode Referensi Transaksi: <strong className="font-mono text-foreground font-bold">{paymentReference}</strong>
                                                    </li>
                                                )}
                                                <li>Masukkan nominal tepat sebesar: <strong className="font-bold text-foreground">Rp {(invoice.amount || 0).toLocaleString('id-ID')}</strong>.</li>
                                                <li>Klik tombol <strong>Bayar</strong> pada simulator. Sistem akan mengonfirmasi pembayaran secara otomatis.</li>
                                                <li>Kembali ke halaman ini dan klik tombol <strong>Cek Status Pembayaran</strong> di sidebar.</li>
                                            </ol>
                                        </div>
                                    )}

                                    {/* QRIS Instructions */}
                                    <div className="rounded-xl bg-muted/40 p-4 text-xs space-y-3 text-muted-foreground">
                                        {dynamicInstructions.length > 0 ? (
                                            dynamicInstructions.map((group, idx) => (
                                                <div key={idx} className="space-y-1.5">
                                                    <p className="font-semibold text-foreground">{group.title}</p>
                                                    <ol className="list-inside list-decimal space-y-1">
                                                        {(group.steps || []).map((step, sIdx) => (
                                                            <li
                                                                key={sIdx}
                                                                dangerouslySetInnerHTML={{ __html: step }}
                                                            />
                                                        ))}
                                                    </ol>
                                                </div>
                                            ))
                                        ) : (
                                            <>
                                                <p className="font-semibold text-foreground">Cara Pembayaran QRIS:</p>
                                                <ol className="list-inside list-decimal space-y-1">
                                                    <li>Buka aplikasi Mobile Banking atau E-Wallet pilihan Anda.</li>
                                                    <li>Pilih menu <strong>Scan QR / Bayar</strong>.</li>
                                                    <li>Arahkan kamera smartphone ke kode QR di atas.</li>
                                                    <li>Pastikan nama merchant adalah <strong>Level Up Counting</strong> dan total nominal sesuai.</li>
                                                    <li>Konfirmasi pembayaran dan masukkan PIN Anda.</li>
                                                </ol>
                                            </>
                                        )}
                                    </div>
                                </Card>
                            )}

                            {/* State: Virtual Account / Payment Code Card */}
                            {!isPaid && isVa && (
                                <Card className="overflow-hidden border border-border/60 bg-card p-6 shadow-md">
                                    <div className="flex items-center justify-between border-b pb-4">
                                        <div className="flex items-center gap-3">
                                            <BankLogo bankCode={invoice.payment_channel || 'MANDIRIVA'} size="md" />
                                            <div>
                                                <h3 className="font-bold text-foreground">{bankName}</h3>
                                                <p className="text-xs text-muted-foreground">
                                                    Transfer Otomatis Terverifikasi
                                                    {invoice.payment_reference ? ` • Ref: ${invoice.payment_reference}` : ''}
                                                </p>
                                            </div>
                                        </div>
                                        {!isFailed && !isOverdue && (
                                            <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-600">
                                                <Clock className="h-4 w-4" />
                                                <span>{timeLeft || 'Memuat timer...'}</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* VA Number / Pay Code Section */}
                                    <div className={`my-6 rounded-2xl p-6 text-center border ${
                                        isOverdue || isFailed ? 'bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-900' : 'bg-muted/30'
                                    }`}>
                                        <div className="mb-3 flex justify-center">
                                            <BankLogo bankCode={invoice.payment_channel || 'MANDIRIVA'} size="lg" />
                                        </div>
                                        <span className="text-xs uppercase tracking-wider text-muted-foreground">
                                            Nomor Virtual Account / Kode Pembayaran
                                        </span>
                                        <div className="mt-2 flex items-center justify-center gap-3">
                                            <span className={`font-mono text-2xl font-black tracking-wider sm:text-3xl ${
                                                isOverdue || isFailed ? 'text-muted-foreground line-through' : 'text-foreground'
                                            }`}>
                                                {payCodeValue || 'Tidak Tersedia'}
                                            </span>
                                            {payCodeValue && !isOverdue && !isFailed && (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => copyToClipboard(payCodeValue, 'va')}
                                                    className="h-9 px-3 gap-1.5"
                                                >
                                                    {copiedVa ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                                                    <span>{copiedVa ? 'Disalin' : 'Salin'}</span>
                                                </Button>
                                            )}
                                        </div>

                                        {(isOverdue || isFailed) && (
                                            <p className="mt-2 text-xs font-semibold text-red-600">
                                                Nomor pembayaran ini telah tidak aktif karena transaksi kedaluwarsa atau dibatalkan.
                                            </p>
                                        )}
                                    </div>

                                    {/* Action Buttons: Tripay Hosted & Simulator */}
                                    {!isOverdue && !isFailed && (
                                        <div className="mb-6 flex flex-col sm:flex-row items-center justify-center gap-3 w-full max-w-md mx-auto">
                                            {hostedPaymentUrl && (
                                                <Button asChild size="lg" className="w-full sm:flex-1 font-bold gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
                                                    <a href={hostedPaymentUrl} target="_blank" rel="noopener noreferrer">
                                                        <ExternalLink className="h-4 w-4" />
                                                        Buka Halaman Tripay
                                                    </a>
                                                </Button>
                                            )}
                                            {isSandbox && (
                                                <Button asChild variant="outline" size="lg" className="w-full sm:flex-1 font-bold gap-2 border-indigo-400 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300">
                                                    <a href={tripaySimulatorUrl} target="_blank" rel="noopener noreferrer">
                                                        <ExternalLink className="h-4 w-4" />
                                                        Bayar via Simulator
                                                    </a>
                                                </Button>
                                            )}
                                        </div>
                                    )}

                                    {/* Simulator Guide for Virtual Account */}
                                    {!isPaid && !isFailed && !isOverdue && isSandbox && (
                                        <div className="mb-6 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-xs space-y-2 text-indigo-950 dark:border-indigo-900/40 dark:bg-indigo-950/20 dark:text-indigo-200">
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold flex items-center gap-1.5">
                                                    <CheckCircle2 className="h-4 w-4 text-indigo-600" />
                                                    Langkah Bayar via Simulator Tripay ({bankName}):
                                                </span>
                                                <a
                                                    href={tripaySimulatorUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="font-semibold underline text-indigo-700 hover:text-indigo-800 dark:text-indigo-300 flex items-center gap-1"
                                                >
                                                    Buka Simulator <ExternalLink className="h-3 w-3" />
                                                </a>
                                            </div>
                                            <ol className="list-inside list-decimal space-y-1 text-muted-foreground dark:text-indigo-300/80">
                                                <li>Salin Nomor Virtual Account di atas ({payCodeValue}).</li>
                                                <li>Klik tombol <strong>Bayar via Simulator</strong> di atas untuk membuka portal simulator Tripay.</li>
                                                <li>Pilih tab <strong>Virtual Account ({bankName})</strong> pada halaman simulator.</li>
                                                <li>Tempel nomor Virtual Account dan masukkan nominal: <strong className="font-bold text-foreground">Rp {(invoice.amount || 0).toLocaleString('id-ID')}</strong>.</li>
                                                <li>Klik tombol <strong>Bayar</strong> pada simulator.</li>
                                                <li>Kembali ke halaman ini dan klik tombol <strong>Cek Status Pembayaran</strong> di sidebar.</li>
                                            </ol>
                                        </div>
                                    )}

                                    {/* VA / Payment Instructions */}
                                    <div className="rounded-xl bg-muted/40 p-4 text-xs space-y-3 text-muted-foreground">
                                        {dynamicInstructions.length > 0 ? (
                                            dynamicInstructions.map((group, idx) => (
                                                <div key={idx} className="space-y-1.5">
                                                    <p className="font-semibold text-foreground">{group.title}</p>
                                                    <ol className="list-inside list-decimal space-y-1">
                                                        {(group.steps || []).map((step, sIdx) => (
                                                            <li
                                                                key={sIdx}
                                                                dangerouslySetInnerHTML={{ __html: step }}
                                                            />
                                                        ))}
                                                    </ol>
                                                </div>
                                            ))
                                        ) : (
                                            <>
                                                <p className="font-semibold text-foreground">Cara Pembayaran {bankName}:</p>
                                                <ol className="list-inside list-decimal space-y-1">
                                                    <li>Buka aplikasi m-Banking atau kunjungi ATM terdekat.</li>
                                                    <li>Pilih menu <strong>Transfer / Pembayaran &gt; Virtual Account</strong>.</li>
                                                    <li>Masukkan nomor Virtual Account: <strong className="font-mono">{payCodeValue}</strong>.</li>
                                                    <li>Periksa nama tagihan dan pastikan nominal tepat sebesar <strong>Rp {(invoice.amount || 0).toLocaleString('id-ID')}</strong>.</li>
                                                    <li>Konfirmasi dan selesaikan pembayaran. Transaksi akan terverifikasi secara instan.</li>
                                                </ol>
                                            </>
                                        )}
                                    </div>
                                </Card>
                            )}
                        </div>

                        {/* Order Summary & Actions Sidebar */}
                        <div className="space-y-6">
                            <Card className="border border-border/60 bg-card p-6 shadow-md">
                                <h3 className="font-bold text-foreground border-b pb-3">Ringkasan Tagihan</h3>

                                <div className="mt-4 space-y-3 text-sm">
                                    <div>
                                        <span className="text-xs text-muted-foreground">Produk:</span>
                                        <p className="font-semibold text-foreground line-clamp-2">{productTitle}</p>
                                    </div>

                                    <div className="flex justify-between text-muted-foreground pt-2 border-t text-xs">
                                        <span>Metode Pembayaran</span>
                                        <span className="font-medium text-foreground uppercase">{isQris ? 'QRIS' : `VA ${bankName}`}</span>
                                    </div>

                                    <div className="flex justify-between text-muted-foreground text-xs">
                                        <span>Harga Produk</span>
                                        <span>Rp {(invoice.nett_amount || 0).toLocaleString('id-ID')}</span>
                                    </div>

                                    {invoice.transaction_fee > 0 && (
                                        <div className="flex justify-between text-muted-foreground text-xs">
                                            <span>Biaya Layanan</span>
                                            <span>Rp {invoice.transaction_fee.toLocaleString('id-ID')}</span>
                                        </div>
                                    )}

                                    <div className="flex justify-between items-center pt-3 border-t font-bold text-foreground">
                                        <span>Total Pembayaran</span>
                                        <div className="text-right">
                                            <span className="text-lg text-orange-600">
                                                Rp {(invoice.amount || 0).toLocaleString('id-ID')}
                                            </span>
                                        </div>
                                    </div>

                                    {!isPaid && !isOverdue && !isFailed && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="w-full text-xs text-muted-foreground hover:text-foreground"
                                            onClick={() => copyToClipboard(invoice.amount.toString(), 'amount')}
                                        >
                                            {copiedAmount ? <Check className="mr-1 h-3 w-3 text-green-600" /> : <Copy className="mr-1 h-3 w-3" />}
                                            {copiedAmount ? 'Nominal Disalin' : 'Salin Nominal Tepat'}
                                        </Button>
                                    )}
                                </div>

                                <div className="mt-6 space-y-2 pt-4 border-t">
                                    {isPaid ? (
                                        <Button asChild className="w-full font-semibold gap-2 bg-green-600 hover:bg-green-700 text-white">
                                            <Link href={productLink}>
                                                Buka Materi Belajar
                                                <ArrowRight className="h-4 w-4" />
                                            </Link>
                                        </Button>
                                    ) : (
                                        <>
                                            {hostedPaymentUrl && !isOverdue && !isFailed && (
                                                <Button asChild size="lg" className="w-full font-bold gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
                                                    <a href={hostedPaymentUrl} target="_blank" rel="noopener noreferrer">
                                                        <ExternalLink className="h-4 w-4" />
                                                        Buka Halaman Tripay
                                                    </a>
                                                </Button>
                                            )}

                                            {!isOverdue && !isFailed && isSandbox && (
                                                <Button asChild variant="outline" size="lg" className="w-full font-bold gap-2 border-indigo-400 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300">
                                                    <a href={tripaySimulatorUrl} target="_blank" rel="noopener noreferrer">
                                                        <ExternalLink className="h-4 w-4" />
                                                        Bayar via Simulator Tripay
                                                    </a>
                                                </Button>
                                            )}

                                            <Button
                                                type="button"
                                                className="w-full font-semibold gap-2 bg-orange-600 hover:bg-orange-700 text-white"
                                                onClick={handleCheckStatus}
                                                disabled={isChecking}
                                            >
                                                <RefreshCw className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`} />
                                                {isChecking ? 'Memeriksa...' : 'Cek Status Pembayaran'}
                                            </Button>
                                        </>
                                    )}

                                    {invoice.status === 'pending' && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="w-full text-red-600 border-red-200 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"
                                            onClick={handleCancelInvoice}
                                            disabled={isCancelling}
                                        >
                                            {isCancelling ? 'Membatalkan...' : 'Batalkan Tagihan'}
                                        </Button>
                                    )}

                                    {(isFailed || isOverdue) && (
                                        <Button asChild variant="outline" className="w-full">
                                            <Link href="/courses">Buat Pesanan Baru</Link>
                                        </Button>
                                    )}

                                    <Button asChild variant="ghost" className="w-full text-xs">
                                        <Link href="/profile/my-courses">Kembali ke Dashboard</Link>
                                    </Button>
                                </div>
                            </Card>
                        </div>
                    </div>
                </div>
            </UserLayout>
        </div>
    );
}
