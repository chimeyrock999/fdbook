import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

// The classes of <Keyword> and <Tag>, exported so the Notes Studio draws its
// keyword decorations with the same ones (studio scans this file).
// Bold inside a keyword keeps the keyword colour instead of the prose bold colour.
export const keywordClassName =
	"font-medium text-[var(--color-graph-primary)] underline decoration-dotted underline-offset-4 [&_strong]:text-inherit";
const tagOnlyClassName =
	"not-prose inline-flex items-center rounded-full border border-[var(--color-graph-primary-muted)] bg-[color-mix(in_oklab,var(--color-graph-primary-muted)_30%,transparent)] px-2.5 py-1 text-[0.75rem] font-medium text-[var(--color-graph-primary)] underline decoration-dotted underline-offset-4";
export const tagClassName = cn(keywordClassName, tagOnlyClassName);

type GraphObjectProps = {
	id: string;
	displayName: string;
	children: ReactNode;
	className?: string;
};

type SectionTitleProps = GraphObjectProps & {
	as?: "h2" | "h3" | "h4" | "h5" | "h6";
} & Omit<ComponentPropsWithoutRef<"h2">, "children" | "className" | "id">;

export function SectionTitle({
	as,
	id,
	displayName,
	className,
	children,
	...props
}: SectionTitleProps) {
	const Component = as ?? "h3";

	return (
		<Component
			id={id}
			data-graph-id={id}
			data-graph-display-name={displayName}
			className={className}
			{...props}
		>
			{children}
		</Component>
	);
}

export function Keyword({
	id,
	displayName,
	className,
	children,
	...props
}: GraphObjectProps &
	Omit<ComponentPropsWithoutRef<"span">, "children" | "className" | "id">) {
	return (
		<span
			id={id}
			data-graph-id={id}
			data-graph-display-name={displayName}
			className={cn(keywordClassName, className)}
			{...props}
		>
			{children}
		</span>
	);
}

export function Tag({
	id,
	displayName,
	className,
	children,
	...props
}: GraphObjectProps &
	Omit<ComponentPropsWithoutRef<"span">, "children" | "className" | "id">) {
	return (
		<Keyword
			id={id}
			displayName={displayName}
			className={cn(tagOnlyClassName, className)}
			{...props}
		>
			{children}
		</Keyword>
	);
}

type GraphMetaProps = {
	id: string;
	displayName?: string;
	graphType?: "section" | "keyword";
	graphKind?: "section" | "keyword";
};

export function GraphMeta(_props: GraphMetaProps) {
	return null;
}
