import type * as React from 'react';

export type IconName = 'plus' | 'search' | 'settings' | 'hud' | 'grid' | 'bot' | 'capabilities' | 'chat' | 'artifact' | 'clock' | 'terminal' | 'check' | 'close' | 'mic' | 'send' | 'split' | 'branch' | 'folder' | 'chevron' | 'copy' | 'refresh' | 'more' | 'pin' | 'stop' | 'steer';

/** Logo KostoLabs AI : tuile + logotype avec AI en exposant. */
export interface LogoProps { variant?: 'lockup' | 'lockup-mark' | 'tile' | 'mark'; name?: 'full' | 'short'; size?: number; tone?: 'ink' | 'inverse'; className?: string; style?: React.CSSProperties }
export declare function Logo(props: LogoProps): React.ReactElement;

/** Icône au trait 24×24 en currentColor. */
export interface IconProps { name: IconName; size?: number; label?: string; strokeWidth?: number; className?: string; style?: React.CSSProperties }
export declare function Icon(props: IconProps): React.ReactElement;

/** Bouton. primary une fois par zone ; label sert d'aria-label pour iconOnly. */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'md' | 'sm'; icon?: IconName; iconRight?: IconName; iconOnly?: boolean; label?: string; href?: string }
export declare function Button(props: ButtonProps): React.ReactElement;

/** Statut d'une session ou d'un élément. Libellé par défaut en français. */
export interface StatusChipProps { status: 'running' | 'attention' | 'error' | 'done' | 'idle'; label?: string; children?: React.ReactNode }
export declare function StatusChip(props: StatusChipProps): React.ReactElement;

/** Compteur court (nombre ou mot). */
export interface BadgeProps { tone?: 'neutral' | 'attention' | 'danger' | 'inverse'; label?: string; children?: React.ReactNode }
export declare function Badge(props: BadgeProps): React.ReactElement;

/** Initiales d'un projet dans un carré. */
export interface ProjectAvatarProps { initials: string; name?: string; tone?: 'ink' | 'strong' | 'outline'; size?: number }
export declare function ProjectAvatar(props: ProjectAvatarProps): React.ReactElement;

/** Élément de navigation latérale. */
export interface NavItemProps { label?: string; icon?: IconName; href?: string; active?: boolean; count?: string | number; countTone?: 'neutral' | 'attention' | 'danger' | 'inverse'; children?: React.ReactNode }
export declare function NavItem(props: NavItemProps): React.ReactElement;

/** Champ de recherche / palette de commandes. */
export interface SearchFieldProps { placeholder?: string; label?: string; shortcut?: string; defaultValue?: string }
export declare function SearchField(props: SearchFieldProps): React.ReactElement;

/** Contrôle segmenté (filtres, onglets courts). */
export interface SegmentedProps { options: Array<string | { value: string; label: string }>; value?: string; defaultValue?: string; onChange?: (value: string) => void; label?: string; size?: 'md' | 'sm'; block?: boolean }
export declare function Segmented(props: SegmentedProps): React.ReactElement;

/** Jauge d'utilisation du contexte, jusqu'à trois segments. */
export interface ContextMeterProps { label?: string; value?: string; segments: Array<{ label: string; percent: number }> }
export declare function ContextMeter(props: ContextMeterProps): React.ReactElement;

/** Panneau titré. */
export interface PanelProps { title?: string; meta?: string; actionLabel?: string; actionHref?: string; tone?: 'default' | 'strong'; children?: React.ReactNode }
export declare function Panel(props: PanelProps): React.ReactElement;

declare global { interface Window { KLAI: { Logo: typeof Logo; Icon: typeof Icon; Button: typeof Button; StatusChip: typeof StatusChip; Badge: typeof Badge; ProjectAvatar: typeof ProjectAvatar; NavItem: typeof NavItem; SearchField: typeof SearchField; Segmented: typeof Segmented; ContextMeter: typeof ContextMeter; Panel: typeof Panel; iconNames: string[] } } }
