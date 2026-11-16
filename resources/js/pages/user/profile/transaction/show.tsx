import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import UserLayout from '@/layouts/user-layout';
import { Head, Link } from '@inertiajs/react';
import axios from 'axios';
import { AlertTriangle, Calendar, CheckCircle, Clock, CreditCard, ExternalLink, FileText, Home, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface CourseItem {
    id: string;
    course: {
        id: string;
        title: string;
        slug: string;
        thumbnail: string;
    };
}

interface BootcampItem {
    id: string;
    bootcamp: {
        id: string;
        title: string;
        slug: string;
        thumbnail: string;
    };
}

interface WebinarItem {
    id: string;
    webinar: {
        id: string;
        title: string;
        slug: string;
        thumbnail: string;
    };
}

interface CertificationProgramItem {
    id: string;
    certificationProgram: {
        id: string;
        title: string;
        slug: string;
        thumbnail: string;
    };
}

interface BundleItem {
    id: string;
    bundle: {
        id: string;
        title: string;
        slug: string;
        thumbnail?: string;
    };
}

interface InstallmentTerm {
    id: string;
    invoice_id?: string;
    child_invoice_id?: string | null;
    term_number?: number;
    installment_number?: number;
    amount: number;
    due_date?: string | null;
    installment_due_date?: string | null;
    status: 'pending' | 'paid' | 'overdue' | string;
    paid_at: string | null;
    invoice_url?: string | null;
    invoice_code?: string;
    invoice?: {
        id: string;
        invoice_code: string;
        invoice_url: string | null;
        status: string;
    };
}

interface Invoice {
    id: string;
    invoice_code: string;
    invoice_url: string;
    amount: number;
    nett_amount: number;
    discount_amount: number;
    status: 'paid' | 'pending' | 'failed' | 'installment_pending';
    paid_at: string | null;
    expires_at: string | null;
    payment_method: string | null;
    payment_channel: string | null;
    is_installment?: boolean;
    access_suspended_at?: string | null;
    parent_invoice_id?: string | null;
    parent_invoice?: Invoice | null;
    parentInvoice?: Invoice | null;
    installment_terms?: InstallmentTerm[];
    installmentTerms?: InstallmentTerm[];
    course_items?: CourseItem[];
    courseItems?: CourseItem[];
    bootcamp_items?: BootcampItem[];
    bootcampItems?: BootcampItem[];
    webinar_items?: WebinarItem[];
    webinarItems?: WebinarItem[];
    certificationProgramItems?: CertificationProgramItem[];
    certification_program_items?: CertificationProgramItem[];
    bundle_enrollments?: BundleItem[];
    bundleEnrollments?: BundleItem[];
}

interface Props {
    invoice: Invoice;
}

export default function TransactionShow({ invoice }: Props) {
    const { t, i18n } = useTranslation('profile');
    const dateLocale = i18n.language === 'en' ? 'en-US' : 'id-ID';
    const [cancelLoading, setCancelLoading] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);

    const isExpired = invoice.expires_at && new Date() > new Date(invoice.expires_at);
    const timeLeft = invoice.expires_at ? new Date(invoice.expires_at).getTime() - new Date().getTime() : 0;
    const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
    const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

    // Installment detection & helpers
    const isInstallment = Boolean(
        invoice.is_installment ||
        (invoice.installment_terms && invoice.installment_terms.length > 0) ||
        (invoice.installmentTerms && invoice.installmentTerms.length > 0) ||
        invoice.parent_invoice?.is_installment ||
        invoice.parentInvoice?.is_installment
    );

    const terms: InstallmentTerm[] =
        invoice.installment_terms ||
        invoice.installmentTerms ||
        invoice.parent_invoice?.installment_terms ||
        invoice.parentInvoice?.installmentTerms ||
        [];

    const paidTerms = terms.filter((t) => t.status === 'paid');
    const isFullyPaid = (terms.length > 0 && paidTerms.length === terms.length) || invoice.status === 'paid';
    const isSuspended = Boolean(
        invoice.access_suspended_at ||
        invoice.parent_invoice?.access_suspended_at ||
        invoice.parentInvoice?.access_suspended_at
    );
    const isTerm1Paid = paidTerms.some((t) => (t.installment_number ?? t.term_number) === 1);

    const getProductInfo = () => {
        const target = invoice.parent_invoice || invoice.parentInvoice || invoice;
        const courseItems = target.course_items || target.courseItems;
        const bootcampItems = target.bootcamp_items || target.bootcampItems;
        const webinarItems = target.webinar_items || target.webinarItems;
        const certItems = target.certificationProgramItems || target.certification_program_items;
        const bundleItems = target.bundle_enrollments || target.bundleEnrollments;

        if (courseItems && courseItems.length > 0) {
            const course = courseItems[0].course;
            return {
                type: 'course',
                routeParam: 'course',
                name: course.title,
                slug: course.slug,
                thumbnail: course.thumbnail,
                profileRoute: 'profile.course.detail',
                publicRoute: 'course.detail',
                badge: t('transaction.badgeCourse'),
            };
        } else if (bootcampItems && bootcampItems.length > 0) {
            const bootcamp = bootcampItems[0].bootcamp;
            return {
                type: 'bootcamp',
                routeParam: 'bootcamp',
                name: bootcamp.title,
                slug: bootcamp.slug,
                thumbnail: bootcamp.thumbnail,
                profileRoute: 'profile.bootcamp.detail',
                publicRoute: 'bootcamp.detail',
                badge: t('transaction.badgeBootcamp'),
            };
        } else if (webinarItems && webinarItems.length > 0) {
            const webinar = webinarItems[0].webinar;
            return {
                type: 'webinar',
                routeParam: 'webinar',
                name: webinar.title,
                slug: webinar.slug,
                thumbnail: webinar.thumbnail,
                profileRoute: 'profile.webinar.detail',
                publicRoute: 'webinar.detail',
                badge: t('transaction.badgeWebinar'),
            };
        } else if (certItems && certItems.length > 0) {
            const certificationProgram = certItems[0].certificationProgram;
            return {
                type: 'certification-program',
                routeParam: 'program',
                name: certificationProgram.title,
                slug: certificationProgram.slug,
                thumbnail: certificationProgram.thumbnail,
                profileRoute: 'profile.certification-program.detail',
                publicRoute: 'certification-programs.detail',
                badge: t('transaction.badgeCertification'),
            };
        } else if (bundleItems && bundleItems.length > 0) {
            const bundleItem = bundleItems[0];
            return {
                type: 'bundle',
                routeParam: 'bundle',
                name: bundleItem.bundle?.title || t('transaction.bundleDefaultTitle'),
                slug: bundleItem.bundle?.slug || '',
                thumbnail: bundleItem.bundle?.thumbnail || '',
                profileRoute: 'profile.index',
                publicRoute: 'bundle.detail',
                badge: t('transaction.badgeBundle'),
            };
        }
        return null;
    };

    const productInfo = getProductInfo();

    const handleCancelConfirm = async () => {
        setCancelLoading(true);
        setDialogOpen(false);

        try {
            const res = await axios.post(route('invoice.cancel', { id: invoice.id }));
            if (res.data?.success) {
                toast.success(t('transaction.toastCancelSuccess'));
                window.location.reload();
            } else {
                toast.error(res.data?.message || t('transaction.toastCancelFailed'));
            }
        } catch (err: unknown) {
            if (axios.isAxiosError(err)) {
                toast.error(err.response?.data?.message || t('transaction.toastCancelError'));
            } else {
                toast.error(t('transaction.toastCancelError'));
            }
        } finally {
            setCancelLoading(false);
        }
    };

    const getStatusIcon = () => {
        if (isInstallment) {
            if (isFullyPaid) {
                return <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />;
            }
            if (isSuspended) {
                return <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />;
            }
            if (isTerm1Paid) {
                return <Clock className="text-primary h-5 w-5" />;
            }
            return <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />;
        }

        switch (invoice.status) {
            case 'paid':
                return <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />;
            case 'pending':
                return <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />;
            case 'failed':
                return <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />;
            default:
                return <AlertTriangle className="h-5 w-5 text-gray-500" />;
        }
    };

    const getStatusIconBoxClass = () => {
        if (isInstallment) {
            if (isFullyPaid) return 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800/60';
            if (isSuspended) return 'bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-800/60';
            if (isTerm1Paid) return 'bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-800/60';
            return 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800/60';
        }
        switch (invoice.status) {
            case 'paid':
                return 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800/60';
            case 'pending':
                return isExpired
                    ? 'bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-800/60'
                    : 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800/60';
            case 'failed':
                return 'bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-800/60';
            default:
                return 'bg-gray-100 border-gray-200 dark:bg-zinc-800 dark:border-zinc-700';
        }
    };

    const getStatusText = () => {
        if (isInstallment) {
            if (isFullyPaid) {
                return t('transaction.installmentFullyPaidExcl');
            }
            if (isSuspended) {
                return t('transaction.accessSuspended');
            }
            if (isTerm1Paid) {
                return t('transaction.installmentActiveTerms', { paid: paidTerms.length, total: terms.length || 2 });
            }
            return t('transaction.waitingDP');
        }

        switch (invoice.status) {
            case 'paid':
                return t('transaction.paymentSuccessExcl');
            case 'pending':
                return isExpired ? t('transaction.statusExpired') : t('transaction.statusPending');
            case 'failed':
                return t('transaction.statusCancelled');
            default:
                return t('transaction.statusUnknown');
        }
    };

    const getStatusBadgeClass = () => {
        if (isInstallment) {
            if (isFullyPaid) return 'text-emerald-600 dark:text-emerald-400';
            if (isSuspended) return 'text-red-600 dark:text-red-400';
            if (isTerm1Paid) return 'text-primary';
            return 'text-amber-600 dark:text-amber-400';
        }
        switch (invoice.status) {
            case 'paid':
                return 'text-emerald-600 dark:text-emerald-400';
            case 'pending':
                return isExpired ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400';
            case 'failed':
                return 'text-red-600 dark:text-red-400';
            default:
                return 'text-gray-600 dark:text-gray-400';
        }
    };

    const canAccessProduct = invoice.status === 'paid' || (isInstallment && isTerm1Paid && !isSuspended);

    return (
        <UserLayout>
            <Head title={t('transaction.headTitle', { code: invoice.invoice_code })} />

            <section className="mx-auto mb-12 w-full max-w-5xl px-4 pt-6">
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    {/* Clean Header Banner */}
                    <div className="flex flex-col justify-between gap-4 border-b border-gray-100 bg-gray-50/60 px-6 py-5 sm:flex-row sm:items-center dark:border-zinc-800 dark:bg-zinc-800/40">
                        <div className="flex items-center gap-3.5">
                            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${getStatusIconBoxClass()}`}>
                                {getStatusIcon()}
                            </div>
                            <div>
                                <h1 className="text-lg font-bold text-gray-900 md:text-xl dark:text-white">{getStatusText()}</h1>
                                <p className="mt-0.5 text-xs text-gray-500 md:text-sm dark:text-gray-400">
                                    {t('transaction.invoiceNumber', { code: invoice.invoice_code })}
                                </p>
                            </div>
                        </div>

                        <Button asChild variant="outline" size="sm" className="w-fit">
                            <Link href={route('profile.transactions')}>
                                {t('transaction.viewAllTransactions')}
                            </Link>
                        </Button>
                    </div>

                    <div className="p-6">
                        {/* Product Info */}
                        {productInfo && (
                            <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-800/40">
                                <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">{t('transaction.purchasedProduct')}</h3>
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                                    <img
                                        src={productInfo.thumbnail ? `/storage/${productInfo.thumbnail}` : '/assets/images/placeholder.png'}
                                        alt={productInfo.name}
                                        className="h-20 w-32 shrink-0 rounded-lg border border-gray-200 object-cover dark:border-zinc-700"
                                    />
                                    <div className="flex-1">
                                        <span className="bg-primary/10 text-primary mb-1.5 inline-block rounded-md px-2 py-0.5 text-xs font-medium capitalize">
                                            {productInfo.badge
                                                ? productInfo.badge
                                                : productInfo.type === 'course'
                                                  ? t('transaction.badgeCourse')
                                                  : productInfo.type === 'bootcamp'
                                                    ? t('transaction.badgeBootcamp')
                                                    : productInfo.type === 'webinar'
                                                      ? t('transaction.badgeWebinar')
                                                      : t('transaction.badgeBundle')}
                                        </span>
                                        <h4 className="font-semibold text-gray-900 dark:text-white">{productInfo.name}</h4>
                                        <div className="mt-2.5 flex flex-wrap gap-2">
                                            {canAccessProduct && productInfo.profileRoute ? (
                                                <Button asChild size="sm" variant="outline" className="bg-white dark:bg-zinc-900">
                                                    <Link
                                                        href={
                                                            productInfo.type === 'bundle'
                                                                ? route('profile.index')
                                                                : route(productInfo.profileRoute, {
                                                                      [productInfo.routeParam || productInfo.type]: productInfo.slug,
                                                                  })
                                                        }
                                                    >
                                                        <ExternalLink className="mr-2 h-3.5 w-3.5" />
                                                        {t('transaction.openInProfile')}
                                                    </Link>
                                                </Button>
                                            ) : (
                                                <Button asChild size="sm" variant="outline" className="bg-white dark:bg-zinc-900">
                                                    <Link
                                                        href={
                                                            productInfo.type === 'bundle'
                                                                ? route('bundle.detail', { bundle: productInfo.slug })
                                                                : route(productInfo.publicRoute, {
                                                                      [productInfo.routeParam || productInfo.type]: productInfo.slug,
                                                                  })
                                                        }
                                                    >
                                                        <ExternalLink className="mr-2 h-3.5 w-3.5" />
                                                        {t('transaction.viewProductDetail')}
                                                    </Link>
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Installment Terms Breakdown */}
                        {isInstallment && terms.length > 0 && (
                            <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-800/40">
                                <div className="mb-4 flex items-center justify-between">
                                    <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                                        <Calendar className="text-primary h-4 w-4" />
                                        {t('transaction.installmentTerms')}
                                    </h3>
                                    <Link
                                        href={route('profile.installments')}
                                        className="text-primary text-xs font-semibold hover:underline"
                                    >
                                        {t('transaction.installmentsPageLink')}
                                    </Link>
                                </div>
                                <div className="space-y-2.5">
                                    {terms.map((term) => {
                                        const isPaid = term.status === 'paid';
                                        const isOverdue = term.status === 'overdue';
                                        const termNumber = term.installment_number ?? term.term_number ?? 1;
                                        const dueDate = term.installment_due_date ?? term.due_date;
                                        const dueDateFormatted = dueDate
                                            ? new Date(dueDate).toLocaleDateString(dateLocale, {
                                                  day: 'numeric',
                                                  month: 'short',
                                                  year: 'numeric',
                                              })
                                            : '-';
                                        const paidDateFormatted = term.paid_at
                                            ? new Date(term.paid_at).toLocaleDateString(dateLocale, {
                                                  day: 'numeric',
                                                  month: 'short',
                                                  year: 'numeric',
                                              })
                                            : null;
                                        const termInvoiceUrl = term.invoice?.invoice_url || term.invoice_url;

                                        return (
                                            <div
                                                key={term.id}
                                                className={`flex flex-col justify-between gap-3 rounded-lg border p-3.5 transition sm:flex-row sm:items-center ${
                                                    isPaid
                                                        ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/20'
                                                        : isOverdue
                                                          ? 'border-red-200 bg-red-50/40 dark:border-red-900/40 dark:bg-red-950/20'
                                                          : 'border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-900'
                                                }`}
                                            >
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                                            {termNumber === 1 ? t('transaction.termDP', { number: termNumber }) : t('transaction.termNumber', { number: termNumber })}
                                                        </span>
                                                        {isPaid ? (
                                                            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                                                                <CheckCircle size={12} />
                                                                {t('installments.statusPaid')}
                                                            </span>
                                                        ) : isOverdue ? (
                                                            <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-300">
                                                                <AlertTriangle size={12} />
                                                                {t('transaction.termOverdueBadge')}
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-300">
                                                                <Clock size={12} />
                                                                {t('installments.termUnpaid')}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                                        {isPaid && paidDateFormatted
                                                            ? t('transaction.paidAtDate', { date: paidDateFormatted })
                                                            : t('transaction.dueDate', { date: dueDateFormatted })}
                                                    </p>
                                                </div>

                                                <div className="flex items-center gap-3">
                                                    <span className="text-sm font-bold text-gray-900 dark:text-white">
                                                        Rp {Number(term.amount).toLocaleString('id-ID')}
                                                    </span>
                                                    {!isPaid && (
                                                        <Button asChild size="sm" variant={isOverdue ? 'destructive' : 'default'}>
                                                            {termInvoiceUrl ? (
                                                                <a href={termInvoiceUrl} target="_blank" rel="noopener noreferrer">
                                                                    {t('transaction.pay')}
                                                                </a>
                                                            ) : (
                                                                <Link href={route('profile.installments')}>
                                                                    {t('transaction.pay')}
                                                                </Link>
                                                            )}
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Alert Messages */}
                        {isInstallment && isSuspended && (
                            <Alert className="mb-6 border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20">
                                <AlertTriangle className="h-4 w-4 text-red-600" />
                                <AlertDescription className="text-red-800 dark:text-red-300">
                                    <strong>{t('transaction.alertSuspendedTitle')}:</strong> {t('transaction.alertSuspendedDesc')}
                                </AlertDescription>
                            </Alert>
                        )}

                        {isInstallment && !isFullyPaid && isTerm1Paid && !isSuspended && (
                            <Alert className="mb-6 border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/20">
                                <Clock className="text-primary h-4 w-4" />
                                <AlertDescription className="text-blue-800 dark:text-blue-300">
                                    <strong>{t('transaction.alertActiveTitle')}:</strong> {t('transaction.alertActiveDesc')}
                                </AlertDescription>
                            </Alert>
                        )}

                        {isInstallment && !isTerm1Paid && invoice.status !== 'failed' && (
                            <Alert className="mb-6 border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20">
                                <Clock className="h-4 w-4 text-amber-600" />
                                <AlertDescription className="text-amber-800 dark:text-amber-300">
                                    <strong>{t('transaction.alertDPTitle')}</strong> {t('transaction.alertDPDesc')}
                                </AlertDescription>
                            </Alert>
                        )}

                        {!isInstallment && invoice.status === 'pending' && !isExpired && (
                            <Alert className="mb-6 border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20">
                                <Clock className="h-4 w-4 text-amber-600" />
                                <AlertDescription className="text-amber-800 dark:text-amber-300">
                                    <div className="flex items-center justify-between">
                                        <span>
                                            {t('transaction.alertPendingDesc', { hours: hoursLeft, minutes: minutesLeft })}
                                        </span>
                                    </div>
                                </AlertDescription>
                            </Alert>
                        )}

                        {!isInstallment && invoice.status === 'pending' && isExpired && (
                            <Alert className="mb-6 border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20">
                                <XCircle className="h-4 w-4 text-red-600" />
                                <AlertDescription className="text-red-800 dark:text-red-300">
                                    {t('transaction.alertExpiredDesc')}
                                </AlertDescription>
                            </Alert>
                        )}

                        {invoice.status === 'failed' && (
                            <Alert className="mb-6 border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20">
                                <XCircle className="h-4 w-4 text-red-600" />
                                <AlertDescription className="text-red-800 dark:text-red-300">
                                    {t('transaction.alertCancelledDesc')}
                                </AlertDescription>
                            </Alert>
                        )}

                        {/* Payment Details & Information */}
                        <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                            <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-800/40">
                                <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">{t('transaction.paymentDetailsTitle')}</h3>
                                <div className="space-y-2.5 text-sm">
                                    {invoice.discount_amount > 0 && (
                                        <>
                                            <div className="flex justify-between">
                                                <span className="text-gray-600 dark:text-gray-400">{t('transaction.originalPrice')}</span>
                                                <span className="font-medium text-gray-900 dark:text-white">
                                                    Rp {(invoice.discount_amount + invoice.nett_amount)?.toLocaleString('id-ID')}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-600 dark:text-gray-400">{t('transaction.discountLabel')}</span>
                                                <span className="text-gray-500 line-through">
                                                    Rp {invoice.discount_amount?.toLocaleString('id-ID') || '0'}
                                                </span>
                                            </div>
                                        </>
                                    )}
                                    <div className="flex justify-between">
                                        <span className="text-gray-600 dark:text-gray-400">{t('transaction.subtotalLabel')}</span>
                                        <span className="font-medium text-gray-900 dark:text-white">Rp {invoice.nett_amount?.toLocaleString('id-ID') || '0'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-600 dark:text-gray-400">{t('transaction.transactionFee')}</span>
                                        <span className="font-medium text-gray-900 dark:text-white">
                                            Rp {((invoice.amount || 0) - (invoice.nett_amount || 0)).toLocaleString('id-ID')}
                                        </span>
                                    </div>
                                    <div className="flex justify-between border-t border-gray-200 pt-2.5 text-base font-bold text-gray-900 dark:border-zinc-700 dark:text-white">
                                        <span>{t('transaction.totalLabel')}</span>
                                        <span>Rp {invoice.amount?.toLocaleString('id-ID') || '0'}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-800/40">
                                <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">{t('transaction.paymentInfo')}</h3>
                                <div className="space-y-2.5 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-gray-600 dark:text-gray-400">{t('transaction.statusLabel')}</span>
                                        <span className={`font-semibold ${getStatusBadgeClass()}`}>{getStatusText()}</span>
                                    </div>
                                    {invoice.payment_method && (
                                        <div className="flex justify-between">
                                            <span className="text-gray-600 dark:text-gray-400">{t('transaction.paymentMethod')}</span>
                                            <span className="font-medium text-gray-900 dark:text-white">{invoice.payment_method}</span>
                                        </div>
                                    )}
                                    {invoice.payment_channel && (
                                        <div className="flex justify-between">
                                            <span className="text-gray-600 dark:text-gray-400">{t('transaction.paymentChannel')}</span>
                                            <span className="font-medium text-gray-900 dark:text-white">{invoice.payment_channel}</span>
                                        </div>
                                    )}
                                    {invoice.paid_at && (
                                        <div className="flex justify-between">
                                            <span className="text-gray-600 dark:text-gray-400">{t('transaction.paidOn')}</span>
                                            <span className="font-medium text-gray-900 dark:text-white">{new Date(invoice.paid_at).toLocaleString(dateLocale)}</span>
                                        </div>
                                    )}
                                    {invoice.expires_at && invoice.status === 'pending' && (
                                        <div className="flex justify-between">
                                            <span className="text-gray-600 dark:text-gray-400">{t('transaction.expiresOn')}</span>
                                            <span className="font-medium text-gray-900 dark:text-white">{new Date(invoice.expires_at).toLocaleString(dateLocale)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex flex-col flex-wrap justify-end gap-3 border-t border-gray-100 pt-5 sm:flex-row dark:border-zinc-800">
                            {canAccessProduct && productInfo && (
                                <Button asChild className="w-full sm:w-auto">
                                    <Link
                                        href={
                                            productInfo.type === 'bundle'
                                                ? route('profile.index')
                                                : productInfo.profileRoute
                                                  ? route(productInfo.profileRoute, {
                                                        [productInfo.routeParam || productInfo.type]: productInfo.slug,
                                                    })
                                                  : route(productInfo.publicRoute, {
                                                        [productInfo.routeParam || productInfo.type]: productInfo.slug,
                                                    })
                                        }
                                    >
                                        <ExternalLink className="mr-2 h-4 w-4" />
                                        {t('transaction.accessProduct', { name: productInfo.badge || t('transaction.product') })}
                                    </Link>
                                </Button>
                            )}

                            {isInstallment && (
                                <Button asChild variant="outline" className="w-full sm:w-auto">
                                    <Link href={route('profile.installments')}>
                                        <CreditCard className="mr-2 h-4 w-4" />
                                        {t('transaction.manageInstallments')}
                                    </Link>
                                </Button>
                            )}

                            {(invoice.status === 'paid' || isTerm1Paid) && (
                                <Button asChild variant="outline" className="w-full sm:w-auto">
                                    <a href={route('invoice.pdf', { id: invoice.id })} target="_blank" rel="noopener noreferrer">
                                        <FileText className="mr-2 h-4 w-4" />
                                        {t('transaction.downloadInvoicePdf')}
                                    </a>
                                </Button>
                            )}

                            {invoice.status === 'pending' && !isExpired && invoice.invoice_url && (
                                <>
                                    <Button asChild className="w-full sm:w-auto">
                                        <a href={invoice.invoice_url} target="_blank" rel="noopener noreferrer">
                                            <ExternalLink className="mr-2 h-4 w-4" />
                                            {isInstallment ? t('transaction.payDPBtn') : t('transaction.continuePayment')}
                                        </a>
                                    </Button>

                                    <Button asChild variant="outline" className="w-full sm:w-auto">
                                        <a href="https://tripay.co.id/simulator" target="_blank" rel="noopener noreferrer">
                                            <ExternalLink className="mr-2 h-4 w-4" />
                                            Bayar via Simulator Tripay
                                        </a>
                                    </Button>

                                    <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
                                        <AlertDialogTrigger asChild>
                                            <Button
                                                variant="outline"
                                                className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 sm:w-auto dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
                                                disabled={cancelLoading}
                                            >
                                                {cancelLoading ? t('transaction.canceling') : t('transaction.cancelOrderBtn')}
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>{t('transaction.cancelOrderTitle')}</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    {t('transaction.cancelOrderDesc')}
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>{t('transaction.cancelOrderNo')}</AlertDialogCancel>
                                                <AlertDialogAction
                                                    onClick={handleCancelConfirm}
                                                    className="border-red-600 bg-red-600 hover:bg-red-700"
                                                >
                                                    {t('transaction.cancelOrderYes')}
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </>
                            )}

                            {(invoice.status === 'failed' || (!isInstallment && isExpired)) && (
                                <>
                                    <Button asChild className="w-full sm:w-auto">
                                        <Link href={route('home')}>
                                            <Home className="mr-2 h-4 w-4" /> {t('transaction.backToHome')}
                                        </Link>
                                    </Button>
                                    {productInfo && (
                                        <Button asChild variant="outline" className="w-full sm:w-auto">
                                            <Link
                                                href={
                                                    productInfo.type === 'bundle'
                                                        ? route('bundle.detail', { bundle: productInfo.slug })
                                                        : route(productInfo.publicRoute, {
                                                              [productInfo.routeParam || productInfo.type]: productInfo.slug,
                                                          })
                                                }
                                            >
                                                <ExternalLink className="mr-2 h-4 w-4" />
                                                {t('transaction.viewProductDetail')}
                                            </Link>
                                        </Button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </section>
        </UserLayout>
    );
}
