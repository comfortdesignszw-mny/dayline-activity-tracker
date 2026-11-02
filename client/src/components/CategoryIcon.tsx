import {
  Dumbbell,
  Briefcase,
  BookOpen,
  Moon,
  GraduationCap,
  Users,
  House,
  HeartPulse,
  ChefHat,
  TrainFront,
  Palette,
  Monitor,
  Trees,
  Circle,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Dumbbell,
  Briefcase,
  BookOpen,
  Moon,
  GraduationCap,
  Users,
  House,
  HeartPulse,
  ChefHat,
  TrainFront,
  Palette,
  Monitor,
  Trees,
  Circle,
};

export function CategoryIcon({
  icon,
  className,
}: {
  icon: string;
  className?: string;
}) {
  const Icon = ICONS[icon] ?? Circle;
  return <Icon className={className} strokeWidth={1.75} />;
}
