INSERT INTO categories (slug, label, color, icon, sort_order) VALUES
  ('exercise', 'Exercise', '#C2410C', 'Dumbbell', 1),
  ('work', 'Work', '#4A5D7E', 'Briefcase', 2),
  ('reading', 'Reading', '#7C6A9C', 'BookOpen', 3),
  ('sleep', 'Sleep', '#5B7C6F', 'Moon', 4),
  ('learning', 'Learning', '#B08968', 'GraduationCap', 5),
  ('social', 'Social', '#A65D57', 'Users', 6),
  ('chores', 'Chores', '#8A8A7E', 'House', 7),
  ('health', 'Health', '#8C6A5D', 'HeartPulse', 8),
  ('cooking', 'Cooking', '#A97C50', 'ChefHat', 9),
  ('commute', 'Commute', '#6E7F8D', 'TrainFront', 10),
  ('creative', 'Creative', '#9A6A8E', 'Palette', 11),
  ('screen', 'Screen time', '#7A7A8C', 'Monitor', 12),
  ('outdoors', 'Outdoors', '#6F8A5E', 'Trees', 13),
  ('other', 'Other', '#9C9188', 'Circle', 14)
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  color = EXCLUDED.color,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order;
