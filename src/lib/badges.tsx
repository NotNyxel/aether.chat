/**
 * Profile badges. They live in the `badges` table so admins can make their own: an icon from the
 * set below, or an uploaded image, with a name, description and color.
 */
import { useQuery } from '@tanstack/react-query';
import {
  Anchor, Award, BadgeCheck, Bird, BookOpen, Bot, Brush, Bug, Cake, Camera, Cat, Cloud, Clover, Code, Coffee, Cpu, Crown, Diamond, Dog, Eye, Feather, Fish,
  Flag, FlaskConical, Flame, Gamepad2, Gem, Ghost, Gift, Globe, HandHeart, Handshake, Headphones, Heart, Infinity as InfinityIcon, Laugh, Leaf, Lightbulb,
  Medal, Megaphone, Mic, Moon, Music, Palette, PartyPopper, PenTool, Pizza, Rabbit, Rocket, Server, Shield, Skull, Smile, Snowflake, Sparkles, Star, Sun,
  Swords, Target, Terminal, Trophy, Wand2, Wrench, Zap, type LucideIcon,
} from 'lucide-react';
import { useSupabase } from './supabase';

/** Icons admins can pick for a badge (the key is what's stored). */
export const BADGE_ICONS: Record<string, LucideIcon> = {
  crown: Crown, shield: Shield, 'badge-check': BadgeCheck, code: Code, terminal: Terminal, cpu: Cpu, server: Server, bot: Bot, wrench: Wrench,
  heart: Heart, 'hand-heart': HandHeart, handshake: Handshake, flask: FlaskConical, bug: Bug, rocket: Rocket, trophy: Trophy, medal: Medal, award: Award,
  star: Star, sparkles: Sparkles, zap: Zap, gem: Gem, diamond: Diamond, flame: Flame, target: Target, flag: Flag, swords: Swords, wand: Wand2,
  music: Music, headphones: Headphones, mic: Mic, megaphone: Megaphone, gamepad: Gamepad2, palette: Palette, brush: Brush, pen: PenTool, camera: Camera,
  book: BookOpen, lightbulb: Lightbulb, globe: Globe, leaf: Leaf, clover: Clover, sun: Sun, moon: Moon, cloud: Cloud, snowflake: Snowflake,
  ghost: Ghost, skull: Skull, eye: Eye, cat: Cat, dog: Dog, rabbit: Rabbit, bird: Bird, fish: Fish, coffee: Coffee, pizza: Pizza, cake: Cake,
  gift: Gift, party: PartyPopper, smile: Smile, laugh: Laugh, anchor: Anchor, feather: Feather, infinity: InfinityIcon,
};

export interface Badge {
  id: string;
  label: string;
  description: string | null;
  color: string;
  icon: string | null;
  icon_url: string | null;
  position: number;
}

/** Used until the list loads (and if it can't), so profiles never show blank badges. */
const FALLBACK: Badge[] = [
  { id: 'founder', label: 'Founder', description: null, color: '#f5c542', icon: 'crown', icon_url: null, position: 0 },
  { id: 'staff', label: 'Aether Staff', description: null, color: '#7c5cff', icon: 'shield', icon_url: null, position: 1 },
  { id: 'developer', label: 'Developer', description: null, color: '#00d4ff', icon: 'code', icon_url: null, position: 2 },
  { id: 'early-supporter', label: 'Early Supporter', description: null, color: '#ff7ab6', icon: 'heart', icon_url: null, position: 3 },
  { id: 'tester', label: 'Beta Tester', description: null, color: '#7bd88f', icon: 'flask', icon_url: null, position: 4 },
  { id: 'bug-hunter', label: 'Bug Hunter', description: null, color: '#ff9f43', icon: 'bug', icon_url: null, position: 5 },
  { id: 'pioneer', label: 'Pioneer', description: null, color: '#5ab0ff', icon: 'rocket', icon_url: null, position: 6 },
  { id: 'champion', label: 'Champion', description: null, color: '#ffd166', icon: 'trophy', icon_url: null, position: 7 },
];

export function useBadges() {
  const sb = useSupabase();
  const q = useQuery({
    queryKey: ['badges'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from('badges').select('id, label, description, color, icon, icon_url, position').order('position');
      if (error) throw new Error(error.message);
      return data as Badge[];
    },
  });
  const list = q.data ?? FALLBACK;
  return { list, byId: new Map(list.map((b) => [b.id, b])), isLoading: q.isLoading };
}

/** A badge's picture: the uploaded image, or its icon in its color. */
export function BadgeGlyph({ badge, size }: { badge: Pick<Badge, 'icon' | 'icon_url' | 'color' | 'label'>; size: number }) {
  if (badge.icon_url) return <img src={badge.icon_url} alt="" width={size} height={size} className="object-contain" draggable={false} style={{ width: size, height: size }} />;
  const Icon = (badge.icon && BADGE_ICONS[badge.icon]) || Award;
  return <Icon size={size} strokeWidth={2.2} style={{ color: badge.color }} />;
}

/** A random id-safe slug from a label ("Cool Person" → "cool-person"). */
export const badgeSlug = (label: string) =>
  label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || `badge-${Math.random().toString(36).slice(2, 8)}`;
