export type Chunk = { ord: number; text: string };

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * Pecah markdown per bagian "##" (judul dokumen + judul bagian ikut di setiap potongan agar mandiri saat
 * dikutip). Bagian yang terlalu panjang dibelah per paragraf. Satu potongan = satu gagasan yang bisa dikutip.
 */
export function chunkMarkdown(markdown: string, maxWords = 180): Chunk[] {
  const lines = markdown.split("\n");
  const title = (lines.find((l) => l.startsWith("# ")) ?? "").replace(/^#\s+/, "").trim();
  const sections: { heading: string; body: string[] }[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) sections.push({ heading: line.replace(/^##\s+/, "").trim(), body: [] });
    else if (!line.startsWith("# ") && sections.length) sections[sections.length - 1].body.push(line);
  }
  const out: Chunk[] = [];
  for (const sec of sections) {
    const paras = sec.body.join("\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    let buf: string[] = [];
    const flush = () => {
      if (!buf.length) return;
      out.push({ ord: out.length, text: `${title} - ${sec.heading}\n${buf.join("\n\n")}` });
      buf = [];
    };
    for (const p of paras) {
      if (buf.length && words(buf.join(" ")) + words(p) > maxWords) flush();
      buf.push(p);
    }
    flush();
  }
  return out;
}
