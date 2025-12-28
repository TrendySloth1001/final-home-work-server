/**
 * TypeScript types and interfaces for Syllabus domain
 */

export interface CreateSyllabusInput {
    teacherId: string;
    subjectName: string;
    className: string;
    board: string;
    term: string;
    academicYear: string;
    overview?: string;
    objectives?: string;
    prerequisites?: string;
    assessmentMethods?: string;
    resources?: string;
}

export interface UpdateSyllabusInput {
    subjectName?: string;
    className?: string;
    board?: string;
    term?: string;
    academicYear?: string;
    overview?: string;
    objectives?: string;
    prerequisites?: string;
    assessmentMethods?: string;
    resources?: string;
    isCompleted?: boolean;
}

export interface ArchiveSyllabusInput {
    syllabusId: string;
    teacherId: string;
}

export interface ChangeSyllabusStageInput {
    syllabusId: string;
    teacherId: string;
    stage: 'draft' | 'published' | 'archived';
}

export interface CreateUnitInput {
    syllabusId: string;
    teacherId: string;
    title: string;
    description?: string;
    teachingHours?: number;
    durationDays?: number;
}

export interface UpdateUnitInput {
    title?: string;
    description?: string;
    teachingHours?: number;
    durationDays?: number;
}

export interface CreateTopicInput {
    unitId: string;
    teacherId: string;
    topicName: string;
    description?: string;
}

export interface UpdateTopicInput {
    topicName?: string;
    description?: string;
}

export interface PaginationOptions {
    page?: number;
    limit?: number;
}

export interface SyllabusQueryOptions extends PaginationOptions {
    includeUnits?: boolean;
    includeTopics?: boolean;
}
