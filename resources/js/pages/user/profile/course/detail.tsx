import RatingDialog from '@/components/rating-dialog';
import { Button } from '@/components/ui/button';
import UserLayout from '@/layouts/user-layout';
import { formatExternalUrl } from '@/lib/utils';
import { Head, Link, router } from '@inertiajs/react';
import { ArrowLeft, Award, BadgeCheck, CheckCircle, Clock, CreditCard, Download, Eye, MessageCircle, Star } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { toast } from 'sonner';
import ProfileInstallmentAction from '@/components/profile-installment-action';

interface Category {
    id: string;
    name: string;
}

interface Course {
    id: string;
    title: string;
    slug: string;
    thumbnail: string;
    level: string;
    category_id: string;
    category: Category;
    course_url: string;
    registration_url: string;
    group_url?: string | null;
    key_points: string;
    description: string | null;
    short_description: string | null;
    status: string;
    user_id: string;
    created_at: string;
    updated_at: string;
}

interface EnrollmentCourseItem {
    id: string;
    invoice_id: string;
    course_id: string;
    course: Course;
    progress: number;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
}

interface CourseProps {
    id: string;
    invoice_code: string;
    invoice_url: string;
    amount: number;
    status: string;
    paid_at: string | null;
    user_id: string;
    course_items: EnrollmentCourseItem[];
    created_at: string;
    updated_at: string;
    is_installment?: boolean;
    installment_terms?: any[];
    access_suspended_at?: string | null;
    has_active_access?: boolean;
    is_fully_paid?: boolean;
}

interface CourseRating {
    id: string;
    user_id: string;
    course_id: string;
    rating: number;
    review: string;
    status: 'pending' | 'approved' | 'rejected';
    created_at: string;
    updated_at: string;
}

interface Certificate {
    id: string;
    title: string;
    certificate_number: string;
    description?: string;
}

interface CertificateParticipant {
    id: string;
    certificate_code: string;
    certificate_number: number;
}

function parseList(items?: string | null): string[] {
    if (!items) return [];
    const matches = items.match(/<li>(.*?)<\/li>/g);
    if (!matches) return [];
    return matches.map((li) => li.replace(/<\/?li>/g, '').trim());
}

export default function DetailMyCourse({
    course,
    courseRating,
    certificate,
    certificateParticipant,
    active_installment,
}: {
    course: CourseProps | null;
    courseRating: CourseRating | null;
    certificate?: Certificate | null;
    certificateParticipant?: CertificateParticipant | null;
    active_installment?: any | null;
}) {
    const { t, i18n } = useTranslation('profile');
    const dateLocale = i18n.language === 'en' ? 'en-US' : 'id-ID';
    const [isRatingDialogOpen, setIsRatingDialogOpen] = useState(false);
    const [isPayingCert, setIsPayingCert] = useState(false);

    const handlePayCertInstallment = async () => {
        if (!course) return;
        setIsPayingCert(true);
        try {
            const res = await axios.post(`/installment/${course.id}/pay`);
            if (res.data?.success && res.data?.payment_url) {
                toast.success(t('courses.detail.redirecting'));
                window.location.href = res.data.payment_url;
            } else {
                toast.error(res.data?.message || t('courses.detail.failPayInstallment'));
                setIsPayingCert(false);
            }
        } catch (err: any) {
            toast.error(err.response?.data?.message || t('courses.detail.errorPayInstallment'));
            setIsPayingCert(false);
        }
    };

    if (!course) {
        return (
            <UserLayout>
                <Head title={t('courses.detail.notFoundTitle')} />
                <div className="flex h-screen items-center justify-center">
                    <p>{t('courses.detail.notFoundDesc')}</p>
                    <Button className="mt-4 rounded-full" variant="secondary" asChild>
                        <Link href="/profile/my-courses">
                            <ArrowLeft /> {t('courses.detail.backToCourses')}
                        </Link>
                    </Button>
                </div>
            </UserLayout>
        );
    }

    const courseItem = course.course_items?.[0];
    const courseData = courseItem?.course;
    const courseInvoiceStatus = course.status;
    const isInstallment = !!course.is_installment;
    const isSuspended = !!course.access_suspended_at;
    const terms = course.installment_terms || (course as any).installmentTerms || [];
    const firstTermPaid = terms.some((t: any) => t.installment_number === 1 && t.status === 'paid');

    const hasActiveAccess = Boolean(
        course.has_active_access ?? (
            isInstallment
                ? (!isSuspended && firstTermPaid)
                : (courseInvoiceStatus === 'paid' || courseInvoiceStatus === 'completed')
        )
    );

    const isFullyPaid = Boolean(
        course.is_fully_paid ?? (
            isInstallment
                ? (terms.length > 0 && terms.every((t: any) => t.status === 'paid'))
                : (courseInvoiceStatus === 'paid' || courseInvoiceStatus === 'completed')
        )
    );

    const keyPointList = parseList(courseData?.key_points);
    const isCompleted = courseItem?.progress === 100;
    const hasCertificate = certificate && isCompleted && courseRating && isFullyPaid;

    const renderCertificateSection = () => {
        if (!courseItem || courseItem.progress !== 100) return null;

        if (!courseRating) {
            return (
                <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-start gap-3">
                            <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                                <Star className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('courses.detail.ratingCongratsTitle')}</h3>
                                <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                                    {t('courses.detail.ratingCongratsDesc')}
                                </p>
                            </div>
                        </div>
                        <Button
                            size="sm"
                            className="shrink-0"
                            onClick={() => setIsRatingDialogOpen(true)}
                        >
                            <Star className="mr-2 h-4 w-4" />
                            {t('courses.detail.btnGiveRating')}
                        </Button>
                    </div>
                </div>
            );
        }

        if (courseRating && !hasCertificate) {
            return (
                <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
                                <Award className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('courses.detail.ratingThankTitle')}</h3>
                                <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                                    {!certificate
                                        ? t('courses.detail.certNotReady')
                                        : !isFullyPaid
                                          ? (isInstallment ? t('courses.detail.certPayInstallment') : t('courses.detail.certPayFull'))
                                          : t('courses.detail.certProcessing')}
                                </p>
                                <div className="mt-1.5 flex items-center gap-1">
                                    <span className="text-xs text-gray-500">{t('courses.detail.yourRating')}</span>
                                    {[1, 2, 3, 4, 5].map((star) => (
                                        <Star
                                            key={star}
                                            className={`h-3.5 w-3.5 ${star <= courseRating.rating ? 'fill-current text-yellow-400' : 'text-gray-300'}`}
                                        />
                                    ))}
                                    <span className="ml-1 text-xs text-gray-500">({courseRating.rating}/5)</span>
                                </div>
                            </div>
                        </div>
                        {isInstallment && !isFullyPaid ? (
                            <Button
                                size="sm"
                                className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0 gap-1.5 font-semibold"
                                onClick={handlePayCertInstallment}
                                disabled={isPayingCert || isSuspended}
                                id="btn-lunasi-sertifikat-course"
                            >
                                <CreditCard className="h-4 w-4" />
                                {isPayingCert ? t('courses.detail.redirectingButton') : t('courses.detail.payInstallmentNow')}
                            </Button>
                        ) : (
                            <Button size="sm" variant="outline" className="shrink-0" disabled>
                                <Download className="mr-2 h-4 w-4" />
                                {!certificate
                                    ? t('courses.detail.certNotAvailable')
                                    : !isFullyPaid
                                      ? t('courses.detail.waitingPayment')
                                      : t('courses.detail.waitingCert')}
                            </Button>
                        )}
                    </div>
                </div>
            );
        }

        if (hasCertificate) {
            return (
                <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                    <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400">
                            <Award className="h-5 w-5" />
                        </div>
                        <div>
                            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('courses.detail.certReadyTitle')}</h3>
                            <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                                {t('courses.detail.certReadyDesc')}
                            </p>
                        </div>
                    </div>

                    <div className="mt-4 flex flex-col justify-between gap-4 border-t border-emerald-200/60 pt-4 sm:flex-row sm:items-center dark:border-emerald-900/40">
                        {certificateParticipant && (
                            <div>
                                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                    {t('courses.detail.certNumber', {
                                        number: `${String(certificateParticipant.certificate_number).padStart(4, '0')}/${certificate?.certificate_number}`,
                                    })}
                                </p>
                                <Link
                                    href={route('certificate.participant.detail', {
                                        code: certificateParticipant.certificate_code,
                                    })}
                                    className="text-primary mt-0.5 inline-block text-xs underline hover:opacity-80"
                                >
                                    {t('courses.detail.viewCertDetail')}
                                </Link>
                            </div>
                        )}

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <Button size="sm" className="w-full" asChild>
                                <a href={route('profile.course.certificate', { course: courseData.slug })} target="_blank">
                                    <Download size={15} className="mr-2" />
                                    {t('courses.detail.downloadCert')}
                                </a>
                            </Button>

                            <Button size="sm" variant="outline" className="w-full bg-white dark:bg-zinc-900" asChild>
                                <a href={route('profile.course.certificate.preview', { course: courseData.slug })} target="_blank">
                                    <Eye size={15} className="mr-2" />
                                    {t('courses.detail.previewCert')}
                                </a>
                            </Button>
                        </div>
                    </div>
                </div>
            );
        }

        return null;
    };

    return (
        <UserLayout>
            <Head title={courseData?.title || t('courses.detail.notFoundTitle')} />
            {!courseData ? (
                <div className="flex h-screen items-center justify-center">
                    <div className="text-center">
                        <p className="mb-4">{t('courses.detail.notFoundDesc')}</p>
                        <Button className="rounded-full" variant="secondary" asChild>
                            <Link href="/profile/my-courses">
                                <ArrowLeft className="mr-2 h-4 w-4" /> {t('courses.detail.backToCourses')}
                            </Link>
                        </Button>
                    </div>
                </div>
            ) : (
                <>
                    <section className="mx-auto w-full max-w-7xl px-4 pt-6 pb-6">
                        <div className="mb-4">
                            <Button variant="ghost" size="sm" className="gap-2 px-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white" asChild>
                                <Link href="/profile/my-courses">
                                    <ArrowLeft className="h-4 w-4" /> {t('courses.detail.backToCourses')}
                                </Link>
                            </Button>
                        </div>

                        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
                            <div className="mb-3 flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:border-blue-800/60 dark:bg-blue-950/40 dark:text-blue-300">
                                    {courseItem &&
                                        t('courses.detail.enrolledIn', {
                                            date: new Date(courseItem.created_at).toLocaleDateString(dateLocale, {
                                                month: 'long',
                                                year: 'numeric',
                                            }),
                                        })}
                                </span>
                                <span className="inline-flex items-center rounded-md border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-300">
                                    {t('courses.detail.levelBadge')} <span className="ml-1 capitalize">{courseData.level}</span>
                                </span>
                                {hasCertificate ? (
                                    <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                                        <Award size={14} />
                                        {t('courses.detail.certAvailable')}
                                    </span>
                                ) : null}
                            </div>

                            <h1 className="text-2xl leading-snug font-bold tracking-tight text-gray-900 sm:text-3xl dark:text-white">
                                {courseData.title}
                            </h1>

                            {courseData.description && (
                                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-600 sm:text-base dark:text-gray-400">
                                    {courseData.description}
                                </p>
                            )}

                            {(isSuspended || !hasActiveAccess || (isInstallment && !isFullyPaid)) && (
                                <div className="mt-5 border-t border-gray-100 pt-5 dark:border-zinc-800">
                                    {isSuspended ? (
                                        <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm dark:border-red-900/50 dark:bg-red-950/30">
                                            <span className="block font-semibold text-red-700 dark:text-red-300">
                                                {t('courses.detail.suspendedNotice')}
                                            </span>
                                            <span className="mt-0.5 block text-xs text-red-600/90 dark:text-red-400">
                                                {t('courses.detail.suspendedSub')}
                                            </span>
                                        </div>
                                    ) : !hasActiveAccess ? (
                                        <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm dark:border-red-900/50 dark:bg-red-950/30">
                                            <span className="block font-semibold text-red-700 dark:text-red-300">
                                                {t('courses.detail.paymentStatus', { status: courseInvoiceStatus.toUpperCase() })}
                                            </span>
                                            <span className="mt-0.5 block text-xs text-red-600/90 dark:text-red-400">
                                                {courseInvoiceStatus === 'failed'
                                                    ? t('courses.detail.paymentFailedSub')
                                                    : t('courses.detail.paymentPendingSub')}
                                            </span>
                                        </div>
                                    ) : isInstallment && !isFullyPaid ? (
                                        <div className="w-full">
                                            <ProfileInstallmentAction
                                                variant="banner"
                                                activeInstallment={active_installment}
                                                invoiceId={course.id}
                                                isInstallment={isInstallment}
                                                isFullyPaid={isFullyPaid}
                                                isSuspended={isSuspended}
                                                paidTerms={terms.filter((t: any) => t.status === 'paid').length}
                                                totalTerms={terms.length}
                                                installmentTerms={terms}
                                            />
                                        </div>
                                    ) : null}
                                </div>
                            )}
                        </div>
                    </section>
                    <section className="mx-auto mb-12 w-full max-w-7xl px-4">
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                            <div className="col-span-2 flex h-full flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                                {renderCertificateSection()}

                                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('courses.detail.yourProgress')}</h2>

                                <div className="mt-4 mb-6">
                                    <div className="mb-2 flex items-center justify-between">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">{t('courses.detail.learningProgress')}</span>
                                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{courseItem?.progress || 0}%</span>
                                    </div>
                                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-zinc-800">
                                        <div
                                            className={`h-full rounded-full transition-all duration-500 ease-out ${
                                                (courseItem?.progress || 0) === 100
                                                    ? 'bg-emerald-600'
                                                    : 'bg-primary'
                                            }`}
                                            style={{ width: `${courseItem?.progress || 0}%` }}
                                        />
                                    </div>
                                </div>

                                <div className="mb-6 rounded-lg border border-gray-100 bg-gray-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('courses.detail.completionStatus')}</span>
                                        <div className="flex items-center gap-2">
                                            {courseItem?.completed_at ? (
                                                <>
                                                    <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                                    <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{t('courses.detail.completed')}</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Clock className="h-4 w-4 text-gray-400" />
                                                    <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('courses.detail.inProgress')}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    {courseItem?.completed_at && (
                                        <div className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                                            {t('courses.detail.completedAt', {
                                                date: new Date(courseItem.completed_at).toLocaleDateString(dateLocale, {
                                                    day: 'numeric',
                                                    month: 'long',
                                                    year: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                }),
                                            })}
                                        </div>
                                    )}
                                </div>

                                {keyPointList.length > 0 && (
                                    <div className="border-t border-gray-100 pt-5 dark:border-zinc-800">
                                        <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('courses.detail.keyPoints')}</h2>
                                        <ul className="mt-3 space-y-2.5 text-sm text-gray-600 dark:text-gray-400">
                                            {keyPointList.map((keyPoint, idx) => (
                                                <li key={idx} className="flex items-start gap-2.5 rounded-lg border border-gray-100 bg-gray-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                                                    <BadgeCheck size={18} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                                    <span className="text-gray-700 dark:text-gray-300">{keyPoint}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>

                            <div className="col-span-1 space-y-4">
                                {isInstallment && (
                                    <ProfileInstallmentAction
                                        variant="card"
                                        activeInstallment={active_installment}
                                        invoiceId={course.id}
                                        isInstallment={isInstallment}
                                        isFullyPaid={isFullyPaid}
                                        isSuspended={isSuspended}
                                        paidTerms={terms.filter((t: any) => t.status === 'paid').length}
                                        totalTerms={terms.length}
                                        installmentTerms={terms}
                                    />
                                )}
                                <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                                    <img
                                        src={courseData.thumbnail ? `/storage/${courseData.thumbnail}` : '/assets/images/placeholder.png'}
                                        alt={courseData.title}
                                        className="aspect-video w-full rounded-lg border border-gray-200 object-cover dark:border-zinc-700"
                                    />
                                    <h2 className="mt-4 font-semibold text-gray-900 dark:text-white">{courseData.title}</h2>
                                    {courseData.short_description && (
                                        <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">{courseData.short_description}</p>
                                    )}

                                    <Button
                                        className="mt-4 w-full"
                                        onClick={() => router.get(route('learn.course.detail', { course: courseData.slug }))}
                                        disabled={!hasActiveAccess}
                                    >
                                        {isCompleted ? t('courses.detail.reviewMaterial') : t('courses.detail.continueLearning')}
                                    </Button>

                                    {courseData.group_url && (
                                        <Button
                                            variant="outline"
                                            className="mt-2 w-full"
                                            asChild={hasActiveAccess}
                                            disabled={!hasActiveAccess}
                                        >
                                            {hasActiveAccess ? (
                                                <a
                                                    href={formatExternalUrl(courseData.group_url)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    <MessageCircle className="mr-2 h-4 w-4" />
                                                    {t('courses.detail.joinWAGroup')}
                                                </a>
                                            ) : (
                                                <span>
                                                    <MessageCircle className="mr-2 h-4 w-4" />
                                                    {t('courses.detail.joinWAGroup')}
                                                </span>
                                            )}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </section>
                </>
            )}

            {courseData && (
                <RatingDialog
                    isOpen={isRatingDialogOpen}
                    onClose={() => setIsRatingDialogOpen(false)}
                    course={{
                        id: courseData.id,
                        title: courseData.title,
                        thumbnail: courseData.thumbnail,
                        description: courseData.description || courseData.short_description || '',
                    }}
                />
            )}
        </UserLayout>
    );
}
