import { prisma } from '../../shared/lib/prisma';
import { NotFoundError, DuplicateError, ValidationError } from '../../shared/lib/errors';
import { addAIJob, getJobStatus } from '../../shared/queues/ai.queue';
import type { 
    CreateSyllabusInput, 
    UpdateSyllabusInput, 
    CreateUnitInput, 
    UpdateUnitInput,
    CreateTopicInput,
    UpdateTopicInput,
    SyllabusQueryOptions,
    ArchiveSyllabusInput,
    ChangeSyllabusStageInput
} from './syllabus.types';

const checkDuplicateSyllabus = async (
    data: CreateSyllabusInput,
    excludeId?: string
): Promise<boolean> => {
    const existing = await prisma.syllabus.findFirst({
        where: {
            teacherId: data.teacherId,
            subjectName: data.subjectName,
            className: data.className,
            board: data.board,
            term: data.term,
            academicYear: data.academicYear,
            ...(excludeId && { id: { not: excludeId } })
        }
    });
    return existing !== null;
};


export const createSyllabusService = async (input: CreateSyllabusInput) => {
    // Check for duplicate
    const isDuplicate = await checkDuplicateSyllabus(input);
    if (isDuplicate) {
        throw new DuplicateError(
            'Syllabus',
            `${input.subjectName} for ${input.className} (${input.term}, ${input.academicYear})`
        );
    }

    const syllabus = await prisma.syllabus.create({
        data: {
            ...input,
            overview: input.overview ?? null,
            objectives: input.objectives ?? null
        }
    });

    return syllabus;
};


export const updateSyllabusService = async (
    syllabusId: string,
    updateData: UpdateSyllabusInput
) => {
    // Validate input
    if (Object.keys(updateData).length === 0) {
        throw new ValidationError('No data provided for update');
    }

    // Check if syllabus exists
    const existing = await prisma.syllabus.findUnique({
        where: { id: syllabusId },
        select: { teacherId: true, subjectName: true, className: true, board: true, term: true, academicYear: true }
    });

    if (!existing) {
        throw new NotFoundError('Syllabus', syllabusId);
    }

    // Check for duplicate if key fields are being updated
    const hasKeyFieldUpdate = ['subjectName', 'className', 'board', 'term', 'academicYear'].some(
        key => key in updateData
    );

    if (hasKeyFieldUpdate) {
        const mergedData: CreateSyllabusInput = {
            teacherId: existing.teacherId,
            subjectName: updateData.subjectName ?? existing.subjectName,
            className: updateData.className ?? existing.className,
            board: updateData.board ?? existing.board,
            term: updateData.term ?? existing.term,
            academicYear: updateData.academicYear ?? existing.academicYear
        };

        const isDuplicate = await checkDuplicateSyllabus(mergedData, syllabusId);
        if (isDuplicate) {
            throw new DuplicateError('Syllabus', 'these parameters');
        }
    }

    const syllabus = await prisma.syllabus.update({
        where: { id: syllabusId },
        data: updateData
    });

    return syllabus;
};


export const getAllSyllabusByTeacherIdService = async (
    teacherId: string,
    options: SyllabusQueryOptions = {}
) => {
    const { includeUnits = true, includeTopics = true, page, limit } = options;

    const syllabuses = await prisma.syllabus.findMany({
        where: { teacherId },
        include: {
            units: includeUnits ? {
                include: {
                    topics: includeTopics ? {
                        select: {
                            id: true,
                            unitId: true,
                            teacherId: true,
                            topicName: true,
                            description: true,
                            keywords: true,
                            order: true,
                            generatedBy: true,
                            createdAt: true,
                            updatedAt: true
                            // embedding excluded
                        }
                    } : false
                }
            } : false
        },
        orderBy: { createdAt: 'desc' },
        ...(page && limit && {
            skip: (page - 1) * limit,
            take: limit
        })
    });

    return syllabuses;
};


export const getSingleSyllabusService = async (syllabusId: string) => {
    const syllabus = await prisma.syllabus.findUnique({
        where: { id: syllabusId },
        include: {
            units: {
                include: {
                    topics: {
                        select: {
                            id: true,
                            unitId: true,
                            teacherId: true,
                            topicName: true,
                            description: true,
                            keywords: true,
                            order: true,
                            generatedBy: true,
                            createdAt: true,
                            updatedAt: true
                            // embedding excluded
                        }
                    }
                }
            }
        }
    });

    if (!syllabus) {
        throw new NotFoundError('Syllabus', syllabusId);
    }

    return syllabus;
};


export const deleteSyllabusService = async (syllabusId: string) => {
    // Check if exists
    const existing = await prisma.syllabus.findUnique({
        where: { id: syllabusId },
        select: { id: true }
    });

    if (!existing) {
        throw new NotFoundError('Syllabus', syllabusId);
    }

    await prisma.syllabus.delete({
        where: { id: syllabusId }
    });

    return { message: 'Syllabus deleted successfully' };
};


export const createUnitService = async (input: CreateUnitInput) => {
    // Verify syllabus exists
    const syllabusExists = await prisma.syllabus.findUnique({
        where: { id: input.syllabusId },
        select: { id: true }
    });

    if (!syllabusExists) {
        throw new NotFoundError('Syllabus', input.syllabusId);
    }

    const unit = await prisma.unit.create({
        data: {
            syllabusId: input.syllabusId,
            teacherId: input.teacherId,
            title: input.title,
            description: input.description ?? null,
            teachingHours: input.teachingHours ?? null,
            durationDays: input.durationDays ?? null
        },
        include: {
            topics: true
        }
    });

    return unit;
};


export const getAllUnitsBySyllabusIdService = async (syllabusId: string) => {
    // Verify syllabus exists
    const syllabusExists = await prisma.syllabus.findUnique({
        where: { id: syllabusId },
        select: { id: true }
    });

    if (!syllabusExists) {
        throw new NotFoundError('Syllabus', syllabusId);
    }

    const units = await prisma.unit.findMany({
        where: { syllabusId },
        include: {
            topics: true
        },
        orderBy: {
            id: 'asc'
        }
    });

    return units;
};


export const getSingleUnitService = async (unitId: string) => {
    const unit = await prisma.unit.findUnique({
        where: { id: unitId },
        include: {
            topics: true,
            syllabus: {
                select: {
                    id: true,
                    subjectName: true,
                    className: true
                }
            }
        }
    });

    if (!unit) {
        throw new NotFoundError('Unit', unitId);
    }

    return unit;
};


export const updateUnitService = async (
    unitId: string,
    updateData: UpdateUnitInput
) => {
    // Validate input
    if (Object.keys(updateData).length === 0) {
        throw new ValidationError('No data provided for update');
    }

    // Check if exists
    const existing = await prisma.unit.findUnique({
        where: { id: unitId },
        select: { id: true }
    });

    if (!existing) {
        throw new NotFoundError('Unit', unitId);
    }

    const unit = await prisma.unit.update({
        where: { id: unitId },
        data: updateData,
        include: {
            topics: true
        }
    });

    return unit;
};


export const deleteUnitService = async (unitId: string) => {
    // Check if exists
    const existing = await prisma.unit.findUnique({
        where: { id: unitId },
        select: { id: true }
    });

    if (!existing) {
        throw new NotFoundError('Unit', unitId);
    }

    await prisma.unit.delete({
        where: { id: unitId }
    });

    return { message: 'Unit deleted successfully' };
};


export const createTopicService = async (input: CreateTopicInput) => {
    if (!input.topicName || input.topicName.trim().length === 0) {
        throw new ValidationError('Topic name cannot be empty');
    }

    // Verify unit exists
    const unitExists = await prisma.unit.findUnique({
        where: { id: input.unitId },
        select: { id: true }
    });

    if (!unitExists) {
        throw new NotFoundError('Unit', input.unitId);
    }

    const topic = await prisma.topic.create({
        data: {
            unitId: input.unitId,
            teacherId: input.teacherId,
            topicName: input.topicName.trim(),
            ...(input.description ? { description: input.description } : {})
        }
    });

    return topic;
};


export const createMultipleTopicsService = async (
    unitId: string,
    teacherId: string,
    topicsInput: string[] | Array<{ topicName: string; description?: string }>
) => {
    // Verify unit exists
    const unitExists = await prisma.unit.findUnique({
        where: { id: unitId },
        select: { id: true, teacherId: true }
    });

    if (!unitExists) {
        throw new NotFoundError('Unit', unitId);
    }
    
    // Verify teacherId matches
    if (unitExists.teacherId !== teacherId) {
        throw new ValidationError('Unauthorized: Unit does not belong to this teacher');
    }

    // Normalize input to handle both formats
    let topicsData: Array<{ topicName: string; description?: string }>;
    
    if (topicsInput.length > 0 && typeof topicsInput[0] === 'string') {
        // Array of strings format
        topicsData = (topicsInput as string[])
            .map(name => name.trim())
            .filter(name => name.length > 0)
            .map(topicName => ({ topicName }));
    } else {
        // Array of objects format
        topicsData = (topicsInput as Array<{ topicName: string; description?: string }>)
            .filter(topic => topic.topicName && topic.topicName.trim().length > 0)
            .map(topic => ({
                topicName: topic.topicName.trim(),
                ...(topic.description ? { description: topic.description } : {})
            }));
    }

    if (topicsData.length === 0) {
        throw new ValidationError('At least one valid topic is required');
    }

    // Use transaction for bulk insert
    const topics = await prisma.$transaction(
        topicsData.map(topicData =>
            prisma.topic.create({
                data: {
                    unitId,
                    teacherId,
                    ...topicData
                }
            })
        )
    );

    return topics;
};


export const getAllTopicsByUnitIdService = async (unitId: string) => {
    // Verify unit exists
    const unitExists = await prisma.unit.findUnique({
        where: { id: unitId },
        select: { id: true }
    });

    if (!unitExists) {
        throw new NotFoundError('Unit', unitId);
    }

    const topics = await prisma.topic.findMany({
        where: { unitId },
        orderBy: {
            id: 'asc'
        }
    });

    return topics;
};


export const getSingleTopicService = async (topicId: string) => {
    const topic = await prisma.topic.findUnique({
        where: { id: topicId },
        include: {
            unit: {
                select: {
                    id: true,
                    title: true,
                    syllabusId: true,
                    description:  true,
                }
            }
        }
    });

    if (!topic) {
        throw new NotFoundError('Topic', topicId);
    }

    return topic;
};


export const updateTopicService = async (topicId: string, updateData: { topicName?: string; description?: string }) => {
    if (Object.keys(updateData).length === 0) {
        throw new ValidationError('No data provided for update');
    }

    if (updateData.topicName !== undefined && updateData.topicName.trim().length === 0) {
        throw new ValidationError('Topic name cannot be empty');
    }

    // Check if exists
    const existing = await prisma.topic.findUnique({
        where: { id: topicId },
        select: { id: true }
    });

    if (!existing) {
        throw new NotFoundError('Topic', topicId);
    }

    const dataToUpdate: any = {};
    if (updateData.topicName !== undefined) {
        dataToUpdate.topicName = updateData.topicName.trim();
    }
    if (updateData.description !== undefined) {
        dataToUpdate.description = updateData.description || null;
    }

    const topic = await prisma.topic.update({
        where: { id: topicId },
        data: dataToUpdate
    });

    return topic;
};


export const deleteTopicService = async (topicId: string) => {
    // Check if exists
    const existing = await prisma.topic.findUnique({
        where: { id: topicId },
        select: { id: true }
    });

    if (!existing) {
        throw new NotFoundError('Topic', topicId);
    }

    await prisma.topic.delete({
        where: { id: topicId }
    });

    return { message: 'Topic deleted successfully' };
};


/**
 * Archive/Unarchive syllabus
 */
export const archiveSyllabusService = async (syllabusId: string, teacherId: string, archive: boolean = true) => {
    // Verify syllabus exists and belongs to teacher
    const existing = await prisma.syllabus.findFirst({
        where: { id: syllabusId, teacherId },
        select: { id: true }
    });

    if (!existing) {
        throw new NotFoundError('Syllabus', syllabusId);
    }

    const syllabus = await prisma.syllabus.update({
        where: { id: syllabusId },
        data: {
            isArchived: archive,
            archivedAt: archive ? new Date() : null,
            ...(archive ? { stage: 'archived' } : {})
        }
    });

    return syllabus;
};

/**
 * Change syllabus stage (draft -> published -> archived)
 */
export const changeSyllabusStageService = async (
    syllabusId: string,
    teacherId: string,
    stage: 'draft' | 'published' | 'archived'
) => {
    // Verify syllabus exists and belongs to teacher
    const existing = await prisma.syllabus.findFirst({
        where: { id: syllabusId, teacherId },
        select: { id: true }
    });

    if (!existing) {
        throw new NotFoundError('Syllabus', syllabusId);
    }

    const updateData: any = { stage };
    
    // If archiving, also set archive fields
    if (stage === 'archived') {
        updateData.isArchived = true;
        updateData.archivedAt = new Date();
    }

    const syllabus = await prisma.syllabus.update({
        where: { id: syllabusId },
        data: updateData
    });

    return syllabus;
};

/**
 * Calculate and update completion percentage for syllabus
 * Based on: units with topics vs total units
 */
export const calculateSyllabusCompletionService = async (syllabusId: string) => {
    const syllabus = await prisma.syllabus.findUnique({
        where: { id: syllabusId },
        include: {
            units: {
                include: {
                    _count: {
                        select: { topics: true }
                    }
                }
            }
        }
    });

    if (!syllabus) {
        throw new NotFoundError('Syllabus', syllabusId);
    }

    if (syllabus.units.length === 0) {
        return await prisma.syllabus.update({
            where: { id: syllabusId },
            data: { completionStage: 0 }
        });
    }

    // Calculate: units with topics / total units
    const unitsWithTopics = syllabus.units.filter((unit: { _count: { topics: number } }) => unit._count.topics > 0).length;
    const completionPercentage = Math.round((unitsWithTopics / syllabus.units.length) * 100);

    const updated = await prisma.syllabus.update({
        where: { id: syllabusId },
        data: { completionStage: completionPercentage }
    });

    return updated;
};

/**
 * Calculate and update completion percentage for unit
 * Based on: number of topics (0=0%, 1-2=33%, 3-4=66%, 5+=100%)
 */
export const calculateUnitCompletionService = async (unitId: string) => {
    const unit = await prisma.unit.findUnique({
        where: { id: unitId },
        include: {
            _count: {
                select: { topics: true }
            }
        }
    });

    if (!unit) {
        throw new NotFoundError('Unit', unitId);
    }

    const topicCount = unit._count.topics;
    let completionPercentage = 0;

    if (topicCount === 0) completionPercentage = 0;
    else if (topicCount <= 2) completionPercentage = 33;
    else if (topicCount <= 4) completionPercentage = 66;
    else completionPercentage = 100;

    const updated = await prisma.unit.update({
        where: { id: unitId },
        data: { completionStage: completionPercentage }
    });

    return updated;
};

/**
 * Queue AI syllabus generation job
 */
export const queueSyllabusGenerationService = async (data: {
  teacherId: string;
  subjectName: string;
  className: string;
  board?: string;
  term?: string;
  academicYear?: string;
  description?: string;
}) => {
  // Validation
  if (!data.teacherId || !data.subjectName || !data.className) {
    throw new ValidationError('teacherId, subjectName, and className are required');
  }

  // Queue the generation job with high priority
  const jobId = await addAIJob(
    {
      type: 'syllabus-generation',
      teacherId: data.teacherId,
      syllabusData: {
        subjectName: data.subjectName,
        className: data.className,
        ...(data.board ? { board: data.board } : {}),
        ...(data.term ? { term: data.term } : {}),
        ...(data.academicYear ? { academicYear: data.academicYear } : {}),
        ...(data.description ? { description: data.description } : {})
      }
    },
    10 // High priority
  );

  return { jobId };
};

/**
 * Get syllabus generation job status
 */
export const getSyllabusGenerationStatusService = async (jobId: string) => {
  const status = await getJobStatus(jobId);
  
  if (!status) {
    throw new NotFoundError('Job', jobId);
  }

  return {
    jobId: status.id,
    state: status.state,
    progress: status.progress,
    attemptsMade: status.attemptsMade,
    syllabusId: status.result?.data?.syllabus?.id,
    unitsCount: status.result?.data?.unitsCount,
    topicsCount: status.result?.data?.topicsCount,
    error: status.failedReason
  };
};

/**
 * Publish syllabus (draft → live)
 */
export const publishSyllabusService = async (syllabusId: string, teacherId: string) => {
  // Verify syllabus exists and belongs to teacher
  const existing = await prisma.syllabus.findFirst({
    where: { id: syllabusId, teacherId },
    select: { id: true, published: true }
  });

  if (!existing) {
    throw new NotFoundError('Syllabus', syllabusId);
  }

  if (existing.published) {
    throw new ValidationError('Syllabus is already published');
  }

  const syllabus = await prisma.syllabus.update({
    where: { id: syllabusId },
    data: {
      published: true,
      stage: 'published'
    },
    include: {
      units: {
        include: {
          topics: true
        }
      }
    }
  });

  return syllabus;
};

/**
 * Get all versions of a syllabus
 */
export const getSyllabusVersionsService = async (
  teacherId: string,
  subjectName: string,
  className: string,
  board: string,
  term: string,
  academicYear: string
) => {
  const versions = await prisma.syllabus.findMany({
    where: {
      teacherId,
      subjectName,
      className,
      board,
      term,
      academicYear
    },
    orderBy: {
      version: 'desc'
    },
    select: {
      id: true,
      version: true,
      isLatest: true,
      published: true,
      stage: true,
      generatedBy: true,
      createdAt: true,
      updatedAt: true,
      objectives: true,
      overview: true,
      _count: {
        select: {
          units: true
        }
      }
    }
  });

  return versions;
};

/**
 * Get a specific version of a syllabus
 */
export const getSyllabusVersionService = async (syllabusId: string, teacherId: string) => {
  const syllabus = await prisma.syllabus.findFirst({
    where: { 
      id: syllabusId,
      teacherId 
    },
    include: {
      units: {
        include: {
          topics: {
            select: {
              id: true,
              unitId: true,
              teacherId: true,
              topicName: true,
              description: true,
              keywords: true,
              order: true,
              generatedBy: true,
              createdAt: true,
              updatedAt: true
              // embedding excluded
            }
          }
        }
      }
    }
  });

  if (!syllabus) {
    throw new NotFoundError('Syllabus version', syllabusId);
  }

  return syllabus;
};

/**
 * Compare two versions of a syllabus
 */
export const compareSyllabusVersionsService = async (
  version1Id: string,
  version2Id: string,
  teacherId: string
) => {
  const [v1, v2] = await Promise.all([
    prisma.syllabus.findFirst({
      where: { id: version1Id, teacherId },
      include: {
        units: {
          include: {
            topics: true
          }
        }
      }
    }),
    prisma.syllabus.findFirst({
      where: { id: version2Id, teacherId },
      include: {
        units: {
          include: {
            topics: true
          }
        }
      }
    })
  ]);

  if (!v1 || !v2) {
    throw new NotFoundError('Syllabus version', !v1 ? version1Id : version2Id);
  }

  // Basic comparison
  const comparison = {
    version1: {
      id: v1.id,
      version: v1.version,
      createdAt: v1.createdAt,
      unitsCount: v1.units.length,
      topicsCount: v1.units.reduce((sum: number, u: { topics: unknown[] }) => sum + u.topics.length, 0)
    },
    version2: {
      id: v2.id,
      version: v2.version,
      createdAt: v2.createdAt,
      unitsCount: v2.units.length,
      topicsCount: v2.units.reduce((sum: number, u: { topics: unknown[] }) => sum + u.topics.length, 0)
    },
    differences: {
      objectives: v1.objectives !== v2.objectives,
      overview: v1.overview !== v2.overview,
      prerequisites: v1.prerequisites !== v2.prerequisites,
      assessmentMethods: v1.assessmentMethods !== v2.assessmentMethods,
      resources: v1.resources !== v2.resources,
      unitsChanged: v1.units.length !== v2.units.length
    },
    fullData: {
      version1: v1,
      version2: v2
    }
  };

  return comparison;
};

/**
 * Mark a specific version as the active/latest one
 */
export const setLatestVersionService = async (syllabusId: string, teacherId: string) => {
  const syllabus = await prisma.syllabus.findFirst({
    where: { id: syllabusId, teacherId },
    select: {
      teacherId: true,
      subjectName: true,
      className: true,
      board: true,
      term: true,
      academicYear: true
    }
  });

  if (!syllabus) {
    throw new NotFoundError('Syllabus', syllabusId);
  }

  // Mark all other versions as not latest
  await prisma.syllabus.updateMany({
    where: {
      teacherId: syllabus.teacherId,
      subjectName: syllabus.subjectName,
      className: syllabus.className,
      board: syllabus.board,
      term: syllabus.term,
      academicYear: syllabus.academicYear,
      id: { not: syllabusId }
    },
    data: {
      isLatest: false
    }
  });

  // Mark selected version as latest
  const updated = await prisma.syllabus.update({
    where: { id: syllabusId },
    data: { isLatest: true }
  });

  return updated;
};


// model Syllabus {
//   id           String    @id @default(cuid())
//   teacherId    String     // comes from POST request

//   // School fields
//   subjectName  String
//   className    String       // Example: "Class 6", "Class 10"
//   board        String       // CBSE / ICSE / STATE / IB
//   term         String       // Term 1 / Term 2 / Annual
//   academicYear String

//   overview     String?
//   objectives   String?

//   createdAt    DateTime @default(now())
//   updatedAt    DateTime @updatedAt

//   // Relations
//   units        Unit[]
// }

// model Unit {
//   id            String   @id @default(cuid())
//   syllabusId    String

//   title         String
//   description   String?
//   teachingHours Int?

//   // Relations
//   syllabus      Syllabus @relation(fields: [syllabusId], references: [id])
//   topics        Topic[]
// }

// model Topic {
//   id        String   @id @default(cuid())
//   unitId    String

//   topicName String

//   // Relations
//   unit      Unit @relation(fields: [unitId], references: [id])
// }