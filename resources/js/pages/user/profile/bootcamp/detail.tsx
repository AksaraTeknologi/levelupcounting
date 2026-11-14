import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import UserLayout from '@/layouts/user-layout';
import { formatExternalUrl } from '@/lib/utils';
import { Head, Link, router } from '@inertiajs/react';
import { 
    ArrowLeft,
    Award,
    BadgeCheck,
    Calendar,
    CheckCircle,
    Clock,
    CreditCard,
    Download,
    ExternalLink,
    Eye,
    LinkIcon,
    MessageSquare,
    Upload,
    Users,
    X, ArrowRight, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { toast } from 'sonner';
import ProfileInstallmentAction from '@/components/profile-installment-action';

interface Category {
    id: string;
    name: string;
}

interface BootcampSchedule {
    id: string;
    schedule_date: string;
    day: string;
    start_time: string;
    end_time: string;
    recording_url: string | null;
}

interface BootcampAttendance {
    id: string;
    enrollment_bootcamp_id: string;
    bootcamp_schedule_id: string;
    attendance_proof: string;
    verified: boolean;
    notes?: string;
    bootcamp_schedule: BootcampSchedule;
}

interface Bootcamp {
    id: string;
    title: string;
    slug: string;
    thumbnail: string;
    category_id: string;
    start_date: string;
    end_date: string;
    category: Category;
    bootcamp_url: string;
    registration_url: string;
    benefits: string;
    curriculum: string;
    description: string | null;
    short_description: string | null;
    group_url: string | null;
    status: string;
    schedules: BootcampSchedule[];
    has_submission_link: boolean;
    has_certificate?: boolean;
    requires_review?: boolean;
    next_step_product?: {
        id: string;
        title: string;
        slug: string;
        thumbnail?: string | null;
        price: number;
        strikethrough_price?: number;
        type: string;
        type_label: string;
        url: string;
    } | null;
    created_at: string;
    updated_at: string;
}

interface EnrollmentBootcampItem {
    id: string;
    invoice_id: string;
    bootcamp_id: string;
    bootcamp: Bootcamp;
    progress: number;
    completed_at: string | null;
    attendances: BootcampAttendance[];
    submission?: string | null;
    submission_verified: boolean;
    rating?: number | null;
    review?: string | null;
    reviewed_at?: string | null;
    created_at: string;
    updated_at: string;
}

interface BootcampProps {
    id: string;
    invoice_code: string;
    invoice_url: string;
    amount: number;
    status: string;
    paid_at: string | null;
    user_id: string;
    bootcamp_items: EnrollmentBootcampItem[];
    created_at: string;
    updated_at: string;
    is_installment?: boolean;
    installment_terms?: any[];
    access_suspended_at?: string | null;
    has_active_access?: boolean;
    is_fully_paid?: boolean;
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

interface DetailBootcampProps {
    bootcamp: BootcampProps;
    certificate?: Certificate | null;
    certificateParticipant?: CertificateParticipant | null;
    active_installment?: any | null;
}

function parseList(items?: string | null): string[] {
    if (!items) return [];
    const matches = items.match(/<li>(.*?)<\/li>/g);
    if (!matches) return [];
    return matches.map((li) => li.replace(/<\/?li>/g, '').trim());
}

function getYoutubeId(url: string) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : '';
}

const StarRating = ({
    rating,
    onRatingChange,
    readonly = false,
}: {
    rating: number;
    onRatingChange?: (rating: number) => void;
    readonly?: boolean;
}) => {
    return (
        <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
                <button
                    key={star}
                    type="button"
                    disabled={readonly}
                    onClick={() => !readonly && onRatingChange?.(star)}
                    className={`text-2xl transition-colors ${
                        star <= rating ? 'text-yellow-400' : readonly ? 'text-gray-300' : 'text-gray-300 hover:text-yellow-300'
                    } ${readonly ? 'cursor-default' : 'cursor-pointer'}`}
                >
                    ★
                </button>
            ))}
        </div>
    );
};

export default function DetailMyBootcamp({ bootcamp, certificate, certificateParticipant, active_installment }: DetailBootcampProps) {
    const { t, i18n } = useTranslation('profile');
    const dateLocale = i18n.language === 'en' ? 'en-US' : 'id-ID';
    const bootcampItem = bootcamp.bootcamp_items?.[0];
    const bootcampData = bootcampItem?.bootcamp;
    const bootcampInvoiceStatus = bootcamp.status;
    const isInstallment = !!bootcamp.is_installment;
    const isSuspended = !!bootcamp.access_suspended_at;
    const terms = bootcamp.installment_terms || (bootcamp as any).installmentTerms || [];
    const firstTermPaid = terms.some((t: any) => t.installment_number === 1 && t.status === 'paid');

    const hasActiveAccess = Boolean(
        bootcamp.has_active_access ?? (
            isInstallment
                ? (!isSuspended && firstTermPaid)
                : (bootcampInvoiceStatus === 'paid' || bootcampInvoiceStatus === 'completed')
        )
    );

    const isFullyPaid = Boolean(
        bootcamp.is_fully_paid ?? (
            isInstallment
                ? (terms.length > 0 && terms.every((t: any) => t.status === 'paid'))
                : (bootcampInvoiceStatus === 'paid' || bootcampInvoiceStatus === 'completed')
        )
    );

    const benefitList = parseList(bootcampData?.benefits);
    const curriculumList = parseList(bootcampData?.curriculum);
    const [isLoading, setIsLoading] = useState(true);

    const [showUploadForms, setShowUploadForms] = useState<{ [key: string]: boolean }>({});
    const [selectedFiles, setSelectedFiles] = useState<{ [key: string]: File | null }>({});
    const [notes, setNotes] = useState<{ [key: string]: string }>({});
    const [uploading, setUploading] = useState<{ [key: string]: boolean }>({});

    const [showSubmissionForm, setShowSubmissionForm] = useState(false);
    const [submissionUrl, setSubmissionUrl] = useState(bootcampItem?.submission || '');
    const [submittingSubmission, setSubmittingSubmission] = useState(false);

    const [showReviewForm, setShowReviewForm] = useState(false);
    const [reviewText, setReviewText] = useState(bootcampItem?.review || '');
    const [rating, setRating] = useState(bootcampItem?.rating || 0);
    const [submittingReview, setSubmittingReview] = useState(false);
    const [isPayingCert, setIsPayingCert] = useState(false);

    const handlePayCertInstallment = async () => {
        setIsPayingCert(true);
        try {
            const res = await axios.post(`/installment/${bootcamp.id}/pay`);
            if (res.data?.success && res.data?.payment_url) {
                toast.success(t('bootcamps.detail.btnRedirecting'));
                window.location.href = res.data.payment_url;
            } else {
                toast.error(res.data?.message || t('bootcamps.detail.installmentPayFailed'));
                setIsPayingCert(false);
            }
        } catch (err: any) {
            toast.error(err.response?.data?.message || t('bootcamps.detail.paymentError'));
            setIsPayingCert(false);
        }
    };

    const handleIframeLoad = () => {
        setIsLoading(false);
    };

    const handleFileSelect = (scheduleId: string, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
            if (!validTypes.includes(file.type)) {
                alert(t('bootcamps.detail.formatImageAlert'));
                return;
            }

            if (file.size > 5 * 1024 * 1024) {
                alert(t('bootcamps.detail.maxSizeAlert'));
                return;
            }

            setSelectedFiles((prev) => ({ ...prev, [scheduleId]: file }));
        }
    };

    const handleUploadAttendance = (scheduleId: string) => {
        const file = selectedFiles[scheduleId];
        if (!file || !bootcampItem) return;

        setUploading((prev) => ({ ...prev, [scheduleId]: true }));

        const formData = new FormData();
        formData.append('attendance_proof', file);
        formData.append('enrollment_id', bootcampItem.id);
        formData.append('schedule_id', scheduleId);
        formData.append('notes', notes[scheduleId] || '');

        router.post(route('profile.bootcamp.attendance.upload'), formData, {
            preserveState: false,
            preserveScroll: true,
            onSuccess: () => {
                setShowUploadForms((prev) => ({ ...prev, [scheduleId]: false }));
                setSelectedFiles((prev) => ({ ...prev, [scheduleId]: null }));
                setNotes((prev) => ({ ...prev, [scheduleId]: '' }));
            },
            onError: (errors) => {
                console.error('Upload errors:', errors);
                alert(t('bootcamps.detail.uploadFailedAlert'));
            },
            onFinish: () => {
                setUploading((prev) => ({ ...prev, [scheduleId]: false }));
            },
        });
    };

    const getAttendanceForSchedule = (scheduleId: string) => {
        return bootcampItem?.attendances?.find((att) => att.bootcamp_schedule_id === scheduleId);
    };

    const handleSubmitSubmission = () => {
        if (!submissionUrl.trim() || !bootcampItem) {
            alert(t('bootcamps.detail.fillSubmissionAlert'));
            return;
        }

        setSubmittingSubmission(true);

        router.post(
            route('profile.bootcamp.submission.submit'),
            {
                submission: submissionUrl,
                enrollment_id: bootcampItem.id,
            },
            {
                preserveState: false,
                preserveScroll: true,
                onSuccess: () => {
                    setShowSubmissionForm(false);
                },
                onError: (errors) => {
                    console.error('Submit errors:', errors);
                    alert(t('bootcamps.detail.submitFailedAlert'));
                },
                onFinish: () => {
                    setSubmittingSubmission(false);
                },
            },
        );
    };

    const handleSubmitReview = () => {
        if (!reviewText.trim() || rating === 0 || !bootcampItem) {
            alert(t('bootcamps.detail.fillReviewAlert'));
            return;
        }

        setSubmittingReview(true);

        router.post(
            route('profile.bootcamp.review.submit'),
            {
                rating: rating,
                review: reviewText,
                enrollment_id: bootcampItem.id,
            },
            {
                preserveState: false,
                preserveScroll: true,
                onSuccess: () => {
                    setShowReviewForm(false);
                },
                onError: (errors) => {
                    console.error('Submit errors:', errors);
                    alert(t('bootcamps.detail.reviewFailedAlert'));
                },
                onFinish: () => {
                    setSubmittingReview(false);
                },
            },
        );
    };

    if (!bootcampData || !bootcampItem) {
        return (
            <UserLayout>
                <Head title={t('bootcamps.detail.notFoundTitle')} />
                <div className="flex h-screen items-center justify-center">
                    <p>{t('bootcamps.detail.notFoundDesc')}</p>
                </div>
            </UserLayout>
        );
    }

    const bootcampEndDate = new Date(bootcampData.end_date);
    bootcampEndDate.setHours(23, 59, 59, 999);
    const lastSchedule = bootcampData.schedules?.[bootcampData.schedules.length - 1];
    const isCompleted = lastSchedule ? new Date(`${lastSchedule.schedule_date}T${lastSchedule.end_time}`) < new Date() : bootcampEndDate < new Date();

    const totalSchedules = bootcampData.schedules?.length || 0;
    const verifiedAttendances = bootcampItem.attendances?.filter((att) => att.verified).length || 0;
    const allAttendanceVerified = totalSchedules > 0 && verifiedAttendances === totalSchedules;

    const needsSubmission = bootcampData.has_submission_link;
    const hasSubmission = bootcampItem.submission && bootcampItem.submission_verified;

    const hasReview = bootcampItem.rating && bootcampItem.review;

    const offersCertificate = bootcampData.has_certificate ?? true;
    const requiresReview = bootcampData.requires_review ?? true;

    const hasCertificate =
        offersCertificate &&
        Boolean(certificate) &&
        isCompleted &&
        isFullyPaid &&
        (!requiresReview || (allAttendanceVerified && (!needsSubmission || hasSubmission) && hasReview));

    return (
        <UserLayout>
            <Head title={bootcampData.title} />

            {/* Clean Header Section */}
            <section className="mx-auto w-full max-w-7xl px-4 pt-6 pb-6">
                <div className="mb-4">
                    <Button variant="ghost" size="sm" className="gap-2 px-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white" asChild>
                        <Link href="/profile/my-bootcamps">
                            <ArrowLeft className="h-4 w-4" /> {t('bootcamps.detail.backToBootcamps')}
                        </Link>
                    </Button>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:border-blue-800/60 dark:bg-blue-950/40 dark:text-blue-300">
                            {t('bootcamps.detail.enrolledIn', {
                                date: new Date(bootcampItem.created_at).toLocaleDateString(dateLocale, {
                                    month: 'long',
                                    year: 'numeric',
                                }),
                            })}
                        </span>
                        {hasCertificate && (
                            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                                <Award size={14} />
                                {t('bootcamps.detail.certAvailable')}
                            </span>
                        )}
                        {allAttendanceVerified && (
                            <span className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-300">
                                <CheckCircle size={14} className="text-emerald-600" />
                                {t('bootcamps.detail.attendanceComplete')}
                            </span>
                        )}
                    </div>

                    <h1 className="text-2xl leading-snug font-bold tracking-tight text-gray-900 sm:text-3xl dark:text-white">
                        {bootcampData.title}
                    </h1>

                    {bootcampData.description && (
                        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-600 sm:text-base dark:text-gray-400">
                            {bootcampData.description}
                        </p>
                    )}

                    {(isSuspended || !hasActiveAccess || (isInstallment && !isFullyPaid)) && (
                        <div className="mt-5 border-t border-gray-100 pt-5 dark:border-zinc-800">
                            {isSuspended ? (
                                <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm font-semibold text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                                    {t('bootcamps.detail.suspendedNotice')}
                                </div>
                            ) : !hasActiveAccess ? (
                                <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm font-semibold text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                                    {t('bootcamps.detail.unpaidNotice')}
                                </div>
                            ) : isInstallment && !isFullyPaid ? (
                                <div className="w-full">
                                    <ProfileInstallmentAction
                                        variant="banner"
                                        activeInstallment={active_installment}
                                        invoiceId={bootcamp.id}
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
                    <div className="col-span-2 space-y-6">
                        {isCompleted && (hasCertificate || !offersCertificate) && (
                            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                                <div className="flex items-start gap-4">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                                        <Award size={20} />
                                    </div>
                                    <div className="flex-1">
                                        <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                            <span>{t('bootcamps.detail.congratsBadge')}</span>
                                        </div>
                                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                                            {t('bootcamps.detail.congratsTitle')}
                                        </h2>
                                        <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                                            {t('bootcamps.detail.congratsDesc', { title: bootcampData.title })}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Attendance Section with Recording */}
                        {hasActiveAccess && bootcampData.schedules && bootcampData.schedules.length > 0 && (
                            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                                <div className="mb-5 flex items-center gap-3">
                                    <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                                        <Upload size={20} />
                                    </div>
                                    <div>
                                        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                                            {requiresReview ? t('bootcamps.detail.attendanceAndRecordingTitle') : t('bootcamps.detail.recordingOnlyTitle')}
                                        </h2>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {requiresReview
                                                ? t('bootcamps.detail.attendanceSubtitleReview', { verified: verifiedAttendances, total: totalSchedules })
                                                : t('bootcamps.detail.attendanceSubtitleNoReview')}
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    {bootcampData.schedules.map((schedule, idx) => {
                                        const attendance = getAttendanceForSchedule(schedule.id);
                                        const showForm = showUploadForms[schedule.id];
                                        const isUploading = uploading[schedule.id];
                                        const scheduleDate = new Date(schedule.schedule_date);
                                        const isPast = scheduleDate < new Date();

                                        const videoId = schedule.recording_url ? getYoutubeId(schedule.recording_url) : '';
                                        const embedUrl = videoId ? `https://www.youtube.com/embed/${videoId}` : '';

                                        return (
                                            <div
                                                key={schedule.id}
                                                className={`rounded-lg border p-4 ${
                                                    attendance?.verified
                                                        ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/20'
                                                        : attendance
                                                          ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/20'
                                                          : 'border-gray-200 bg-gray-50/50 dark:border-zinc-800 dark:bg-zinc-800/40'
                                                }`}
                                            >
                                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                    <div className="flex-1">
                                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                                            <div className="flex items-center gap-2">
                                                                <Calendar size={15} className="text-primary" />
                                                                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                                                    {t('bootcamps.detail.meeting', { index: idx + 1 })}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                                                <Clock size={13} />
                                                                <span>
                                                                    {scheduleDate.toLocaleDateString(dateLocale, {
                                                                        day: '2-digit',
                                                                        month: 'short',
                                                                        year: 'numeric',
                                                                    })}{' '}
                                                                    | {schedule.start_time.slice(0, 5)} - {schedule.end_time.slice(0, 5)} WIB
                                                                </span>
                                                            </div>
                                                        </div>
                                                        {attendance && requiresReview && (
                                                            <div className="mt-2 flex items-center gap-2">
                                                                {attendance.verified ? (
                                                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                                                        <CheckCircle size={13} />
                                                                        {t('bootcamps.detail.verified')}
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                                                                        <Clock size={13} />
                                                                        {t('bootcamps.detail.waitingVerification')}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {requiresReview && (
                                                        <div className="flex items-center gap-2">
                                                            {attendance?.verified ? (
                                                                <Button size="sm" variant="outline" disabled>
                                                                    <CheckCircle size={14} className="mr-1" />
                                                                    {t('bootcamps.detail.btnVerified')}
                                                                </Button>
                                                            ) : attendance ? (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    onClick={() =>
                                                                        setShowUploadForms((prev) => ({
                                                                            ...prev,
                                                                            [schedule.id]: !showForm,
                                                                        }))
                                                                    }
                                                                >
                                                                    <Upload size={14} className="mr-1" />
                                                                    {t('bootcamps.detail.btnEditProof')}
                                                                </Button>
                                                            ) : (
                                                                <Button
                                                                    size="sm"
                                                                    disabled={!isPast}
                                                                    onClick={() =>
                                                                        setShowUploadForms((prev) => ({
                                                                            ...prev,
                                                                            [schedule.id]: !showForm,
                                                                        }))
                                                                    }
                                                                >
                                                                    <Upload size={14} className="mr-1" />
                                                                    {isPast ? t('bootcamps.detail.btnUploadProof') : t('bootcamps.detail.btnNotStarted')}
                                                                </Button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Recording Video Section */}
                                                {schedule.recording_url && embedUrl && (
                                                    <div className="mt-4 space-y-2 border-t border-gray-200/70 pt-3 dark:border-zinc-700/60">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                                                {t('bootcamps.detail.recordingHeading')}
                                                            </span>
                                                            <a
                                                                href={schedule.recording_url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
                                                            >
                                                                <ExternalLink size={12} />
                                                                {t('bootcamps.detail.openInYoutube')}
                                                            </a>
                                                        </div>
                                                        <div className="w-full">
                                                            <iframe
                                                                className="aspect-video w-full rounded-lg border border-gray-200 dark:border-zinc-700"
                                                                src={embedUrl}
                                                                title={`Recording Pertemuan ${idx + 1}`}
                                                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                                allowFullScreen
                                                            />
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Upload Form */}
                                                {requiresReview && showForm && (
                                                    <div className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
                                                        <div className="flex items-center justify-between">
                                                            <h5 className="text-sm font-semibold">{t('bootcamps.detail.uploadProofTitle')}</h5>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() =>
                                                                    setShowUploadForms((prev) => ({
                                                                        ...prev,
                                                                        [schedule.id]: false,
                                                                    }))
                                                                }
                                                            >
                                                                <X size={16} />
                                                            </Button>
                                                        </div>

                                                        <div className="space-y-2">
                                                            <Label htmlFor={`file_${schedule.id}`}>
                                                                {t('bootcamps.detail.screenshotLabel')} <span className="text-red-500">*</span>
                                                            </Label>
                                                            <Input
                                                                id={`file_${schedule.id}`}
                                                                type="file"
                                                                accept="image/*"
                                                                onChange={(e) => handleFileSelect(schedule.id, e)}
                                                                className="file:mr-4 file:rounded file:border-0 file:bg-gray-100 file:px-2 file:py-1 file:text-sm file:text-gray-700 hover:file:bg-gray-200"
                                                            />
                                                            <p className="text-xs text-gray-500">{t('bootcamps.detail.fileHint')}</p>
                                                        </div>

                                                        {selectedFiles[schedule.id] && (
                                                            <div className="text-center">
                                                                <img
                                                                    src={URL.createObjectURL(selectedFiles[schedule.id]!)}
                                                                    alt="Preview"
                                                                    className="mx-auto max-h-32 rounded-lg border shadow-sm"
                                                                />
                                                                <p className="mt-2 text-sm text-gray-600">{selectedFiles[schedule.id]?.name}</p>
                                                            </div>
                                                        )}

                                                        <div className="space-y-2">
                                                            <Label htmlFor={`notes_${schedule.id}`}>{t('bootcamps.detail.notesLabel')}</Label>
                                                            <textarea
                                                                id={`notes_${schedule.id}`}
                                                                value={notes[schedule.id] || ''}
                                                                onChange={(e) => setNotes((prev) => ({ ...prev, [schedule.id]: e.target.value }))}
                                                                placeholder={t('bootcamps.detail.notesPlaceholder')}
                                                                className="focus:border-primary focus:ring-primary w-full rounded-lg border border-gray-300 bg-white p-2 text-sm focus:ring-1 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                                                                rows={2}
                                                                maxLength={500}
                                                            />
                                                            <p className="text-xs text-gray-500">
                                                                {t('bootcamps.detail.notesLimit', { count: (notes[schedule.id] || '').length })}
                                                            </p>
                                                        </div>

                                                        <div className="flex gap-2">
                                                            <Button
                                                                variant="outline"
                                                                onClick={() =>
                                                                    setShowUploadForms((prev) => ({
                                                                        ...prev,
                                                                        [schedule.id]: false,
                                                                    }))
                                                                }
                                                                className="flex-1"
                                                            >
                                                                {t('bootcamps.detail.btnCancel')}
                                                            </Button>
                                                            <Button
                                                                onClick={() => handleUploadAttendance(schedule.id)}
                                                                disabled={!selectedFiles[schedule.id] || isUploading}
                                                                className="flex-1"
                                                            >
                                                                {isUploading ? t('bootcamps.detail.btnUploading') : t('bootcamps.detail.btnUploadProof')}
                                                            </Button>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Show existing attendance proof */}
                                                {requiresReview && attendance && !showForm && (
                                                    <div className="mt-3">
                                                        <img
                                                            src={`/storage/${attendance.attendance_proof}`}
                                                            alt="Bukti Kehadiran"
                                                            className="mx-auto max-h-24 rounded border border-gray-200 dark:border-zinc-700"
                                                        />
                                                        {attendance.notes && (
                                                            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                                                                Catatan: {attendance.notes}
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                {requiresReview && totalSchedules > 0 && (
                                    <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3.5 dark:border-zinc-800 dark:bg-zinc-800/50">
                                        <div className="flex items-center justify-between gap-4">
                                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                                {t('bootcamps.detail.attendanceProgress', { verified: verifiedAttendances, total: totalSchedules })}
                                            </span>
                                            <div className="flex items-center gap-2.5">
                                                <div className="h-2 w-28 overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-700">
                                                    <div
                                                        className="bg-primary h-full rounded-full transition-all"
                                                        style={{ width: `${(verifiedAttendances / totalSchedules) * 100}%` }}
                                                    />
                                                </div>
                                                <span className="text-xs font-semibold text-gray-900 dark:text-white">
                                                    {Math.round((verifiedAttendances / totalSchedules) * 100)}%
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Submission Section */}
                        {hasActiveAccess && needsSubmission && allAttendanceVerified && isCompleted && (
                            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                                <div className="mb-4 flex items-center gap-3">
                                    <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                                        <LinkIcon size={18} />
                                    </div>
                                    <div>
                                        <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('bootcamps.detail.projectSubmission')}</h2>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">{t('bootcamps.detail.projectSubmissionDesc')}</p>
                                    </div>
                                </div>

                                {hasSubmission ? (
                                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                                        <div className="mb-1.5 flex items-center gap-2">
                                            <CheckCircle size={16} className="text-emerald-600 dark:text-emerald-400" />
                                            <span className="text-sm font-medium text-emerald-800 dark:text-emerald-200">{t('bootcamps.detail.submissionVerified')}</span>
                                        </div>
                                        <a
                                            href={bootcampItem.submission!}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary text-sm break-all hover:underline"
                                        >
                                            {bootcampItem.submission}
                                        </a>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3.5 text-sm text-gray-700 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-gray-300">
                                            {t('bootcamps.detail.submissionPrompt')}
                                        </div>

                                        {!showSubmissionForm ? (
                                            <Button onClick={() => setShowSubmissionForm(true)} className="w-full">
                                                <Upload size={16} className="mr-2" />
                                                {t('bootcamps.detail.btnUploadProject')}
                                            </Button>
                                        ) : (
                                            <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-800/40">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="text-sm font-semibold">{t('bootcamps.detail.submissionFormTitle')}</h4>
                                                    <Button variant="ghost" size="sm" onClick={() => setShowSubmissionForm(false)}>
                                                        <X size={16} />
                                                    </Button>
                                                </div>

                                                <div className="space-y-2">
                                                    <Label htmlFor="submission_url">
                                                        {t('bootcamps.detail.projectLinkLabel')} <span className="text-red-500">*</span>
                                                    </Label>
                                                    <Input
                                                        id="submission_url"
                                                        type="url"
                                                        value={submissionUrl}
                                                        onChange={(e) => setSubmissionUrl(e.target.value)}
                                                        placeholder="https://link-project-anda"
                                                        className="w-full"
                                                    />
                                                    <p className="text-xs text-gray-500">{t('bootcamps.detail.projectLinkHint')}</p>
                                                </div>

                                                <div className="flex gap-2">
                                                    <Button variant="outline" onClick={() => setShowSubmissionForm(false)} className="flex-1">
                                                        {t('bootcamps.detail.btnCancel')}
                                                    </Button>
                                                    <Button
                                                        onClick={handleSubmitSubmission}
                                                        disabled={!submissionUrl.trim() || submittingSubmission}
                                                        className="flex-1"
                                                    >
                                                        {submittingSubmission ? t('bootcamps.detail.btnSubmitting') : t('bootcamps.detail.btnSendSubmission')}
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Schedule Section */}
                        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                            <div className="mb-4 flex items-center gap-3">
                                <div className="bg-primary/10 text-primary flex h-9 w-9 items-center justify-center rounded-lg">
                                    <Calendar size={18} />
                                </div>
                                <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                                    {isCompleted ? t('bootcamps.detail.periodCompleted') : t('bootcamps.detail.periodUpcoming')}
                                </h3>
                            </div>
                            <div className="space-y-3">
                                <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3.5 dark:border-zinc-800 dark:bg-zinc-800/50">
                                    <Calendar size={16} className="text-primary shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                            {new Date(bootcampData.start_date).toLocaleDateString(dateLocale, {
                                                day: 'numeric',
                                                month: 'long',
                                                year: 'numeric',
                                            })}{' '}
                                            -{' '}
                                            {new Date(bootcampData.end_date).toLocaleDateString(dateLocale, {
                                                day: 'numeric',
                                                month: 'long',
                                                year: 'numeric',
                                            })}
                                        </p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">{t('bootcamps.detail.programDuration')}</p>
                                    </div>
                                </div>

                                {bootcampData.schedules && bootcampData.schedules.length > 0 && (
                                    <div className="space-y-2 pt-1">
                                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">{t('bootcamps.detail.sessionSchedule')}</p>
                                        {bootcampData.schedules.map((schedule, idx) => (
                                            <div key={idx} className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/70 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-800/40">
                                                <Clock size={15} className="text-primary shrink-0" />
                                                <span className="font-medium text-gray-900 capitalize dark:text-white">{schedule.day},</span>
                                                <span className="text-gray-600 dark:text-gray-400">
                                                    {new Date(schedule.schedule_date).toLocaleDateString(dateLocale, {
                                                        day: 'numeric',
                                                        month: 'long',
                                                        year: 'numeric',
                                                    })}{' '}
                                                    | {schedule.start_time.slice(0, 5)} - {schedule.end_time.slice(0, 5)} WIB
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Benefits */}
                        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                            <div className="mb-4 flex items-center gap-3">
                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                                    <BadgeCheck size={18} />
                                </div>
                                <h3 className="text-base font-semibold text-gray-900 dark:text-white">{t('bootcamps.detail.facilities')}</h3>
                            </div>
                            <div className="space-y-2.5">
                                {benefitList.map((benefit, idx) => (
                                    <div key={idx} className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                                        <BadgeCheck size={18} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                        <p className="text-sm text-gray-700 dark:text-gray-300">{benefit}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Curriculum */}
                        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                            <div className="mb-4 flex items-center gap-3">
                                <div className="bg-primary/10 text-primary flex h-9 w-9 items-center justify-center rounded-lg">
                                    <Users size={18} />
                                </div>
                                <h3 className="text-base font-semibold text-gray-900 dark:text-white">{t('bootcamps.detail.curriculum')}</h3>
                            </div>
                            <div className="space-y-2.5">
                                {curriculumList.map((item, idx) => (
                                    <div key={idx} className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-800/50">
                                        <div className="bg-primary/10 text-primary mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-xs font-semibold">
                                            {idx + 1}
                                        </div>
                                        <p className="text-sm text-gray-700 dark:text-gray-300">{item}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Next Step Pelatihan Recommendation Card */}
                        {bootcampData.next_step_product && (
                            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                                <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-3 dark:border-zinc-800">
                                    <div className="flex items-center gap-2">
                                        <Sparkles className="text-primary h-5 w-5" />
                                        <h3 className="text-base font-semibold text-gray-900 dark:text-white">{t('bootcamps.detail.nextStepTitle')}</h3>
                                    </div>
                                    <span className="bg-primary/10 text-primary rounded-md px-2.5 py-0.5 text-xs font-semibold">
                                        {bootcampData.next_step_product.type_label}
                                    </span>
                                </div>
                                <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
                                    {t('bootcamps.detail.nextStepDesc')}
                                </p>
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex flex-1 items-start gap-4">
                                        {bootcampData.next_step_product.thumbnail ? (
                                            <img
                                                src={bootcampData.next_step_product.thumbnail}
                                                alt={bootcampData.next_step_product.title}
                                                className="h-20 w-32 shrink-0 rounded-lg border border-gray-200 object-cover dark:border-zinc-700"
                                            />
                                        ) : (
                                            <div className="flex h-20 w-32 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400 dark:bg-zinc-800">
                                                <Sparkles className="h-6 w-6" />
                                            </div>
                                        )}
                                        <div className="space-y-1">
                                            <h4 className="line-clamp-2 text-base font-semibold text-gray-900 dark:text-white">
                                                {bootcampData.next_step_product.title}
                                            </h4>
                                            <div className="flex items-baseline gap-2">
                                                {bootcampData.next_step_product.price === 0 ? (
                                                    <span className="text-base font-bold text-emerald-600 dark:text-emerald-400">{t('bootcamps.detail.free')}</span>
                                                ) : (
                                                    <>
                                                        <span className="text-base font-bold text-gray-900 dark:text-white">
                                                            Rp {bootcampData.next_step_product.price.toLocaleString(dateLocale)}
                                                        </span>
                                                        {bootcampData.next_step_product.strikethrough_price != null &&
                                                        bootcampData.next_step_product.strikethrough_price > bootcampData.next_step_product.price ? (
                                                            <span className="text-xs text-gray-400 line-through">
                                                                Rp {bootcampData.next_step_product.strikethrough_price.toLocaleString(dateLocale)}
                                                            </span>
                                                        ) : null}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="sm:shrink-0">
                                        <Button asChild className="w-full sm:w-auto">
                                            <a href={bootcampData.next_step_product.url} target="_blank" rel="noopener noreferrer">
                                                {t('bootcamps.detail.registerNow')}
                                                <ArrowRight className="ml-2 h-4 w-4" />
                                            </a>
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Sidebar - Certificate & Review Section */}
                    <div className="col-span-1">
                        <div className="sticky top-6 space-y-4">
                            {/* Certificate Section */}
                            {isCompleted ? (
                                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                                    <div className="mb-4 flex items-center gap-2.5">
                                        <div className="bg-primary/10 text-primary flex h-8 w-8 items-center justify-center rounded-lg">
                                            <Award size={18} />
                                        </div>
                                        <h3 className="font-semibold text-gray-900 dark:text-white">{t('bootcamps.detail.gradCertificate')}</h3>
                                    </div>

                                    {isLoading && hasCertificate && (
                                        <div className="space-y-3">
                                            <Skeleton className="h-[250px] w-full rounded-lg" />
                                            <div className="space-y-2">
                                                <Skeleton className="mx-auto h-3 w-3/4" />
                                                <Skeleton className="mx-auto h-3 w-1/2" />
                                            </div>
                                            <div className="space-y-2">
                                                <Skeleton className="mx-auto h-8 w-full" />
                                                <Skeleton className="mx-auto h-8 w-full" />
                                            </div>
                                        </div>
                                    )}

                                    {!offersCertificate ? (
                                        <div className="space-y-3 py-6 text-center">
                                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-zinc-800">
                                                <Award className="h-6 w-6 text-gray-400" />
                                            </div>
                                            <div>
                                                <h4 className="font-semibold text-gray-900 dark:text-white">{t('bootcamps.detail.noCertificate')}</h4>
                                                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                                    {t('bootcamps.detail.noCertificateDesc')}
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="relative">
                                                {hasCertificate ? (
                                                    <div className={`${isLoading ? 'absolute opacity-0' : 'relative opacity-100'}`}>
                                                        <iframe
                                                            src={`${route('profile.bootcamp.certificate.preview', { bootcamp: bootcampData.slug })}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                                                            className="h-[238px] w-full rounded-lg border border-gray-200 dark:border-zinc-700"
                                                            title={t('bootcamps.detail.previewCert')}
                                                            onLoad={handleIframeLoad}
                                                        />
                                                    </div>
                                                ) : (
                                                    <img
                                                        src={'/assets/images/placeholder.png'}
                                                        alt="Sertifikat"
                                                        className="aspect-video w-full rounded-lg border border-gray-200 object-cover dark:border-zinc-700"
                                                    />
                                                )}
                                            </div>

                                            {hasCertificate ? (
                                                <div className={`${isLoading ? 'opacity-0' : 'opacity-100'}`}>
                                                    <p className="mt-4 text-center text-sm text-gray-600 dark:text-gray-400">
                                                        {t('bootcamps.detail.downloadCertNotice')}
                                                    </p>
                                                    {certificateParticipant && (
                                                        <div className="mt-2 text-center">
                                                            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                                                {t('bootcamps.detail.certNumber', {
                                                                    number: `${String(certificateParticipant.certificate_number).padStart(4, '0')}/${certificate?.certificate_number}`,
                                                                })}
                                                            </p>
                                                            <Link
                                                                href={route('certificate.participant.detail', {
                                                                    code: certificateParticipant.certificate_code,
                                                                })}
                                                                className="text-primary mt-0.5 inline-block text-xs underline hover:opacity-80"
                                                            >
                                                                {t('bootcamps.detail.viewCertDetail')}
                                                            </Link>
                                                        </div>
                                                    )}
                                                    <div className="mt-4 space-y-2">
                                                        <Button className="w-full" asChild>
                                                            <a href={route('profile.bootcamp.certificate', { bootcamp: bootcampData.slug })} target="_blank">
                                                                <Download size={16} className="mr-2" />
                                                                {t('bootcamps.detail.downloadCert')}
                                                            </a>
                                                        </Button>

                                                        <Button variant="outline" className="w-full" asChild>
                                                            <a
                                                                href={route('profile.bootcamp.certificate.preview', { bootcamp: bootcampData.slug })}
                                                                target="_blank"
                                                            >
                                                                <Eye size={16} className="mr-2" />
                                                                {t('bootcamps.detail.btnPreviewCert')}
                                                            </a>
                                                        </Button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <p className="mt-4 text-center text-sm text-gray-600 dark:text-gray-400">
                                                        {!certificate
                                                            ? t('bootcamps.detail.certNotReady')
                                                            : !isFullyPaid
                                                              ? (isInstallment ? t('bootcamps.detail.certPayInstallment') : t('bootcamps.detail.certPayFull'))
                                                              : requiresReview && !allAttendanceVerified ? t('bootcamps.detail.certCompleteAttendance', { verified: verifiedAttendances, total: totalSchedules })
                                                                : requiresReview && needsSubmission && !hasSubmission ? t('bootcamps.detail.certUploadSubmission')
                                                                  : requiresReview && !hasReview ? t('bootcamps.detail.certGiveReview')
                                                                    : t('bootcamps.detail.certWaitBootcamp')}
                                                    </p>
                                                    {isInstallment && !isFullyPaid ? (
                                                        <Button
                                                            className="bg-primary hover:bg-primary/90 text-primary-foreground mt-3 w-full gap-2 font-semibold"
                                                            onClick={handlePayCertInstallment}
                                                            disabled={isPayingCert || isSuspended}
                                                            id="btn-lunasi-sertifikat-bootcamp"
                                                        >
                                                            <CreditCard size={16} />
                                                            {isPayingCert ? t('bootcamps.detail.btnRedirecting') : t('bootcamps.detail.btnPayInstallment')}
                                                        </Button>
                                                    ) : (
                                                        <Button variant="outline" className="mt-3 w-full" disabled>
                                                            <Download size={16} className="mr-2" />
                                                            {!certificate
                                                                ? t('bootcamps.detail.btnCertNotAvailable')
                                                                : !isFullyPaid
                                                                  ? t('bootcamps.detail.btnCompletePayment')
                                                                  : !allAttendanceVerified
                                                                    ? t('bootcamps.detail.btnCompleteAttendance')
                                                                    : needsSubmission && !hasSubmission
                                                                      ? t('bootcamps.detail.btnUploadSubmission')
                                                                      : !hasReview
                                                                        ? t('bootcamps.detail.btnGiveReview')
                                                                        : t('bootcamps.detail.btnWaitBootcamp')}
                                                        </Button>
                                                    )}
                                                </>
                                            )}
                                        </>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {isInstallment && (
                                        <ProfileInstallmentAction
                                            variant="card"
                                            activeInstallment={active_installment}
                                            invoiceId={bootcamp.id}
                                            isInstallment={isInstallment}
                                            isFullyPaid={isFullyPaid}
                                            isSuspended={isSuspended}
                                            paidTerms={terms.filter((t: any) => t.status === 'paid').length}
                                            totalTerms={terms.length}
                                            installmentTerms={terms}
                                        />
                                    )}
                                    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                                        <img
                                            src={bootcampData.thumbnail ? `/storage/${bootcampData.thumbnail}` : '/assets/images/placeholder.png'}
                                            alt={bootcampData.title}
                                            className="aspect-video w-full rounded-lg border border-gray-200 object-cover dark:border-zinc-700"
                                        />
                                        <h3 className="mt-4 font-semibold text-gray-900 dark:text-white">{bootcampData.title}</h3>
                                        {bootcampData.short_description && (
                                            <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">{bootcampData.short_description}</p>
                                        )}
                                        <Button
                                            className="mt-4 w-full"
                                            disabled={!hasActiveAccess}
                                            onClick={() => {
                                                const url = formatExternalUrl(bootcampData.group_url);
                                                if (url) window.open(url, '_blank');
                                            }}
                                        >
                                            <Users size={16} className="mr-2" />
                                            {t('bootcamps.detail.joinWAGroup')}
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* Review Section in Sidebar */}
                            {hasActiveAccess && allAttendanceVerified && (!needsSubmission || hasSubmission) && isCompleted && offersCertificate && requiresReview && (
                                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                                    <div className="mb-4 flex items-center gap-2.5">
                                        <div className="bg-primary/10 text-primary flex h-8 w-8 items-center justify-center rounded-lg">
                                            <MessageSquare size={18} />
                                        </div>
                                        <h3 className="font-semibold text-gray-900 dark:text-white">{t('bootcamps.detail.reviewSectionTitle')}</h3>
                                    </div>

                                    {hasReview ? (
                                        <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/60">
                                            <div className="mb-2 flex items-center gap-1.5">
                                                <CheckCircle size={15} className="text-emerald-600 dark:text-emerald-400" />
                                                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{t('bootcamps.detail.reviewSubmitted')}</span>
                                            </div>
                                            <div className="mb-2">
                                                <StarRating rating={bootcampItem.rating || 0} readonly />
                                            </div>
                                            <p className="text-sm text-gray-700 dark:text-gray-300">"{bootcampItem.review}"</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3.5 text-sm text-gray-700 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-gray-300">
                                                {t('bootcamps.detail.reviewPrompt')}
                                            </div>

                                            {!showReviewForm ? (
                                                <Button onClick={() => setShowReviewForm(true)} className="w-full">
                                                    <MessageSquare size={16} className="mr-2" />
                                                    {t('bootcamps.detail.btnGiveRatingReview')}
                                                </Button>
                                            ) : (
                                                <div className="space-y-4">
                                                    <div className="flex items-center justify-between">
                                                        <h4 className="text-sm font-semibold">{t('bootcamps.detail.reviewFormTitle')}</h4>
                                                        <Button variant="ghost" size="sm" onClick={() => setShowReviewForm(false)}>
                                                            <X size={16} />
                                                        </Button>
                                                    </div>

                                                    <div className="space-y-2">
                                                        <Label className="text-sm">
                                                            {t('bootcamps.detail.ratingLabel')} <span className="text-red-500">*</span>
                                                        </Label>
                                                        <StarRating rating={rating} onRatingChange={setRating} />
                                                        <p className="text-xs text-gray-500">{t('bootcamps.detail.ratingHint')}</p>
                                                    </div>

                                                    <div className="space-y-2">
                                                        <Label htmlFor="review" className="text-sm">
                                                            {t('bootcamps.detail.reviewLabel')} <span className="text-red-500">*</span>
                                                        </Label>
                                                        <textarea
                                                            id="review"
                                                            value={reviewText}
                                                            onChange={(e) => setReviewText(e.target.value)}
                                                            placeholder={t('bootcamps.detail.reviewPlaceholder')}
                                                            className="focus:border-primary focus:ring-primary w-full rounded-lg border border-gray-300 bg-white p-2 text-sm focus:ring-1 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                                                            rows={3}
                                                            maxLength={500}
                                                        />
                                                        <p className="text-xs text-gray-500">{t('bootcamps.detail.notesLimit', { count: reviewText.length })}</p>
                                                    </div>

                                                    <div className="flex gap-2">
                                                        <Button
                                                            variant="outline"
                                                            onClick={() => setShowReviewForm(false)}
                                                            size="sm"
                                                            className="flex-1"
                                                        >
                                                            {t('bootcamps.detail.btnCancel')}
                                                        </Button>
                                                        <Button
                                                            onClick={handleSubmitReview}
                                                            disabled={!reviewText.trim() || rating === 0 || submittingReview}
                                                            size="sm"
                                                            className="flex-1"
                                                        >
                                                            {submittingReview ? t('bootcamps.detail.btnSubmitting') : t('bootcamps.detail.btnSend')}
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </section>
        </UserLayout>
    );
}
