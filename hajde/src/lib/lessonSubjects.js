/**
 * Lesson subject catalogue. Mirrors public.lesson_subjects (DB is the source of
 * truth and rejects unknown ids). Labels live in i18n under lessons.subjects.*
 */
export const LESSON_CATEGORIES = [
  { id: 'languages', subjects: ['english', 'german', 'french', 'italian', 'spanish', 'turkish', 'albanian', 'serbian_croatian', 'macedonian', 'russian', 'arabic', 'chinese', 'japanese', 'swedish', 'sign_language'] },
  { id: 'school', subjects: ['math', 'physics', 'chemistry', 'biology', 'albanian_literature', 'history', 'geography', 'informatics', 'homework_help', 'early_reading'] },
  { id: 'university', subjects: ['state_matura', 'university_entrance', 'calculus', 'statistics', 'economics', 'accounting', 'law', 'medicine_prep', 'engineering', 'thesis_help'] },
  { id: 'tests', subjects: ['ielts', 'toefl', 'cambridge', 'goethe', 'testdaf', 'delf', 'sat', 'gre_gmat'] },
  { id: 'tech', subjects: ['programming', 'web_development', 'mobile_development', 'data_science', 'ai_ml', 'cybersecurity', 'excel_office', 'ui_ux_design', 'graphic_design', 'digital_marketing'] },
  { id: 'music', subjects: ['piano', 'guitar', 'violin', 'singing', 'drums', 'music_theory', 'accordion'] },
  { id: 'art', subjects: ['drawing_painting', 'photography', 'video_editing', 'calligraphy'] },
  { id: 'wellbeing', subjects: ['personal_training', 'yoga', 'swimming', 'martial_arts', 'dance', 'nutrition'] },
  { id: 'career', subjects: ['public_speaking', 'cv_interview', 'entrepreneurship', 'personal_finance', 'sales_marketing', 'project_management'] },
  { id: 'hobbies', subjects: ['chess', 'cooking', 'driving_theory', 'sewing', 'gardening'] },
]

export const ALL_SUBJECTS = LESSON_CATEGORIES.flatMap((c) => c.subjects)
export const categoryOf = (subject) => LESSON_CATEGORIES.find((c) => c.subjects.includes(subject))?.id || null
export const DURATIONS = [30, 45, 60, 90, 120]
