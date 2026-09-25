import { FileIcon as FileGenericIcon, FileSpreadsheetIcon, FileTextIcon, GlobeIcon, PresentationIcon, BracesIcon } from "lucide-react";
import { cn } from "@ui/lib/utils";

/**
 * A small file type tile. The rest of the interface is monochrome; the tile's
 * colour is the one accent, so a spreadsheet and a deck are told apart at a glance
 * the way ChatGPT's and Claude's attachment chips do it.
 */
const KIND_STYLES: Record<string, { Icon: typeof FileTextIcon; className: string; label: string }> = {
  pdf: { Icon: FileTextIcon, className: "bg-[#e5484d] text-white", label: "PDF" },
  xlsx: { Icon: FileSpreadsheetIcon, className: "bg-[#12a150] text-white", label: "Spreadsheet" },
  csv: { Icon: FileSpreadsheetIcon, className: "bg-[#12a150] text-white", label: "CSV" },
  docx: { Icon: FileTextIcon, className: "bg-[#2b6cd8] text-white", label: "Document" },
  pptx: { Icon: PresentationIcon, className: "bg-[#e8710a] text-white", label: "Presentation" },
  json: { Icon: BracesIcon, className: "bg-[#5d5d5d] text-white", label: "JSON" },
  txt: { Icon: FileTextIcon, className: "bg-[#5d5d5d] text-white", label: "Text" },
  md: { Icon: FileTextIcon, className: "bg-[#5d5d5d] text-white", label: "Markdown" },
  web: { Icon: GlobeIcon, className: "bg-[#0d0d0d] text-white", label: "Web page" },
};

export function fileKindLabel(kind: string): string {
  return KIND_STYLES[kind]?.label ?? kind.toUpperCase();
}

export function FileKindIcon({ kind, className }: { kind: string; className?: string }) {
  const style = KIND_STYLES[kind] ?? { Icon: FileGenericIcon, className: "bg-[#8f8f8f] text-white" };
  const { Icon } = style;
  return (
    <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg", style.className, className)} aria-hidden>
      <Icon className="size-4" />
    </span>
  );
}
