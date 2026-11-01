INSERT INTO categories (slug, label, color, icon, sort_order) VALUES
  ('exercise', 'Exercise', '#C2410C', 'Dumbbell', 1),
  ('work', 'Work', '#4A5D7E', 'Briefcase', 2),
  ('reading', 'Reading', '#7C6A9C', 'BookOpen', 3),
  ('sleep', 'Sleep', '#5B7C6F', 'Moon', 4),
  ('learning', 'Learning', '#B08968', 'GraduationCap', 5),
  ('social', 'Social', '#A65D57', 'Users', 6),
  ('chores', 'Chores', '#8A8A7E', 'Home', 7),
  ('other', 'Other', '#9C9188', 'Circle', 8)
ON CONFLICT (slug) DO NOTHING;
