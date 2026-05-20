import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

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
			className={className}
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
			className={cn(
				"not-prose inline-flex items-center rounded-full border border-fd-border bg-fd-card px-2.5 py-1 text-[0.75rem] font-medium text-fd-secondary-foreground",
				className,
			)}
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
