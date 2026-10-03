// The PDF report: layout only.
//
// Every value arrives formatted in document.json -- numbers as the strings the
// compositor shows, tables as rows of cells -- by frontend/src/lib/pdfReport.ts.
// Nothing here computes a figure, so a number in the PDF is the number on the
// screen, and a change of rounding is made in one place.
//
// The identity is terra.sty's (docs/user-manual/tex-files): the four analogous
// tones, a serif body under sans-serif headings, and the three rule colours
// that tell a practical note, a limit and a finding apart by lightness.

#let doc = json("document.json")
#let meta = doc.meta

#let glaze = rgb("#021017")
#let warrior = rgb("#1C2922")
#let waiouru = rgb("#4A4C33")
#let trim = rgb("#726D47")
#let paper = rgb("#F0ECE0")
#let sprout = rgb("#7FD6AE")

#let sans = "IBM Plex Sans"
#let serif = "IBM Plex Serif"
#let mono = "IBM Plex Mono"

#let released = meta.status == "released"
#let status-label = if released { "Released" } else { "Draft" }
#let has(key) = key in doc and doc.at(key) != none and doc.at(key) != "" and doc.at(key) != ()
#let field(d, key) = if key in d and d.at(key) != none { d.at(key) } else { "" }

#set document(title: meta.title, author: field(meta, "author"))
#set text(font: serif, size: 10pt, lang: "en", fallback: true)
#set par(justify: true, leading: 0.62em, spacing: 0.9em)
#show heading: set text(font: sans, fill: warrior)
#show heading.where(level: 1): it => block(above: 1.5em, below: 0.7em, text(size: 12.5pt, it))
#show heading.where(level: 2): it => block(above: 1.1em, below: 0.5em, text(size: 10.5pt, it))
#set heading(numbering: "1.1")
#show raw: set text(font: mono, size: 8.5pt)

#let small-caps-label(s) = text(font: sans, size: 6.5pt, weight: "bold", fill: trim, tracking: 0.04em, upper(s))

#set page(
  paper: "a4",
  margin: (left: 2.2cm, right: 2.2cm, top: 2.7cm, bottom: 2.6cm),
  header: context {
    if counter(page).get().first() > 1 {
      set text(font: sans, size: 7.5pt, fill: waiouru)
      grid(
        columns: (auto, auto, 1fr),
        column-gutter: 0.45em,
        align: horizon,
        image("logo.png", height: 1.1em),
        text(weight: "bold", fill: warrior)[TERRA],
        // A title too long for the header's one line gives way to the number.
        [#text(fill: trim)[Analysis report] #h(1fr) #if meta.title.len() <= 70 { meta.title } else { field(meta, "number") }],
      )
      v(-0.35em)
      line(length: 100%, stroke: 0.4pt + trim)
    }
  },
  footer: context {
    set text(font: sans, size: 7pt, fill: waiouru)
    line(length: 100%, stroke: 0.4pt + trim)
    v(-0.2em)
    [#field(meta, "number") #h(0.8em) Rev. #field(meta, "revision") #h(0.8em) #status-label
      #h(1fr) Page #counter(page).display() of #counter(page).final().first()]
  },
  background: if released { none } else {
    rotate(-45deg, text(font: sans, weight: "bold", size: 96pt, fill: trim.transparentize(88%))[DRAFT])
  },
)

// --- opening --------------------------------------------------------------
// A band from bleed to bleed with the mark and the document type, then the
// title and the identification block. Not a cover: a report opens on what it
// says, and the first page already carries the summary.
#place(top + left, dx: -2.2cm, dy: -2.7cm,
  block(width: 21cm, height: 2.35cm, fill: glaze, inset: (x: 2.2cm),
    grid(
      columns: (auto, auto, 1fr),
      column-gutter: 0.5cm,
      align: horizon,
      rows: 2.35cm,
      image("logo.png", height: 1.35cm),
      stack(spacing: 3pt,
        text(font: sans, weight: "bold", size: 17pt, fill: paper)[TERRA],
        text(font: sans, size: 7.5pt, fill: sprout)[EARTH OBSERVATION]),
      align(right, stack(spacing: 3pt,
        text(font: sans, weight: "bold", size: 10pt, fill: paper)[ANALYSIS REPORT],
        text(font: sans, size: 8.5pt, fill: paper.darken(30%))[
          #field(meta, "number") · Rev. #field(meta, "revision")])),
    )))
#v(0.35cm)
#text(font: sans, weight: "bold", size: 20pt, fill: warrior, meta.title)
#if field(meta, "subtitle") != "" {
  v(0.1em)
  text(font: sans, size: 11.5pt, fill: waiouru, meta.subtitle)
}
#v(0.6em)

// Identification block. Two rows, in ISO 7200's division: what identifies the
// document, then who is responsible for it. An empty field prints a dash, so
// "not applicable" and "forgotten" are not both a blank.
#let id-cell(label, value) = stack(spacing: 3pt, small-caps-label(label),
  text(font: sans, size: 8.5pt, if value == "" { "—" } else { value }))
#block(width: 100%, stroke: (top: 0.8pt + trim, bottom: 0.8pt + trim), inset: (y: 0.6em),
  grid(columns: (1fr,) * 4, row-gutter: 0.9em, column-gutter: 0.4cm,
    id-cell("Document", field(meta, "number")),
    id-cell("Revision", field(meta, "revision")),
    id-cell("Date of issue", field(meta, "issued")),
    id-cell("Status", status-label),
    id-cell("Legal owner", field(meta, "owner")),
    id-cell("Recipient", field(meta, "recipient")),
    id-cell("Creator", field(meta, "author")),
    id-cell("Approved by", field(meta, "approver")),
  ))

// --- rule-marked blocks (terra.sty: aviso, objecao, achado) ---------------
#let ruled(colour, body) = block(width: 100%, inset: (left: 0.9em, y: 0.15em),
  stroke: (left: 0.35em + colour), body)
#let note(body) = ruled(waiouru, text(size: 9pt, body))
#let limit(body) = ruled(warrior, text(size: 9pt, body))

// --- summary and provenance -----------------------------------------------
#if has("summary") {
  heading(numbering: none)[Summary]
  set enum(numbering: n => text(font: sans, weight: "bold", fill: waiouru, str(n)))
  for s in doc.summary { enum.item(s) }
}

#if has("provenance") {
  v(0.4em)
  grid(columns: (3.1cm, 1fr), row-gutter: 0.55em, column-gutter: 0.3cm,
    ..doc.provenance.map(p => (
      text(font: sans, weight: "bold", size: 9pt, fill: waiouru, p.label),
      text(size: 9.5pt, p.value),
    )).flatten())
}

// --- body -------------------------------------------------------------------
#if field(doc, "question") != "" or field(doc, "scope") != "" {
  heading[Question and scope]
  if field(doc, "question") != "" { par(doc.question) }
  if field(doc, "scope") != "" { note(doc.scope) }
}

#if has("method") {
  heading[Method]
  for m in doc.method {
    heading(level: 2, m.product)
    if field(m, "subtitle") != "" { text(style: "italic", m.subtitle); parbreak() }
    for s in m.sections {
      block(above: 0.7em, below: 0.3em, text(font: sans, weight: "bold", size: 8.5pt, fill: waiouru, s.title))
      list(..s.lines.map(l => text(size: 9.5pt, l)))
      if field(s, "note") != "" { note(s.note) }
    }
    if field(m, "source") != "" {
      align(right, text(font: sans, size: 7pt, fill: trim)[Source: #raw(m.source)])
    }
  }
}

// A raster as a map sheet, in the elements a thematic map carries (IBGE,
// Noções básicas de cartografia, Manuais técnicos em geociências 8): a neatline
// with its coordinates on the four sides and crosses where they meet, the
// legend in a box of its own, the north, a graphic and a numeric scale, the
// reference system and the source. Nothing is drawn over the map itself but
// the crosses, so no scale or label hides the ground it describes.
//
// The frontend gives the positions as fractions of the frame; the frame's
// printed width is decided here -- the text width, or narrower where the map
// would pass MAP-HEIGHT -- and the numeric scale follows from it.
#let text-width = 21cm - 4.4cm
#let map-height = 10.5cm
#let has-legend(f) = "legend" in f and f.legend != none and f.legend.len() > 0

// 43217 -> "43 000": two significant figures, thousands set apart by a thin
// space, as SI writes them.
#let scale-denominator(x) = {
  let p = calc.pow(10, calc.max(0, calc.floor(calc.log(x)) - 1))
  let n = str(int(calc.round(x / p) * p))
  let out = ""
  for (i, c) in n.clusters().enumerate() {
    if i > 0 and calc.rem(n.len() - i, 3) == 0 and n.len() > 4 { out += "\u{2009}" }
    out += c
  }
  out
}

// Two columns where the box is wide enough for a class name to stay on one
// line; one otherwise.
#let legend-box(f, columns: 1) = block(width: 100%, stroke: 0.5pt + luma(55%), inset: 5pt, {
  set text(font: sans, size: 7pt, hyphenate: false)
  set par(justify: false)
  set align(left)
  text(weight: "bold", size: 7pt)[Legend]
  v(-0.2em)
  grid(columns: columns, column-gutter: 0.8em, row-gutter: 0.4em,
    ..f.legend.map(e => grid(columns: (1.3em, 1fr), column-gutter: 0.35em, align: left + horizon,
      box(width: 1.3em, height: 0.75em, fill: rgb(e.color), stroke: 0.4pt + luma(30%)),
      e.label)))
})

#let north-arrow = stack(spacing: 1.5pt,
  align(center, text(font: sans, weight: "bold", size: 7pt)[N]),
  align(center, polygon(fill: black, stroke: 0.4pt, (0pt, 12pt), (5pt, 0pt), (10pt, 12pt), (5pt, 8.5pt))))

// A graphic scale of four alternating segments, labelled at 0, half and the
// whole bar.
#let scale-bar(width, ticks) = {
  let seg = width / 4
  box(width: width, height: 1.6em, {
    for i in range(4) {
      place(dx: seg * i, dy: 0pt,
        rect(width: seg, height: 3.5pt, fill: if calc.even(i) { black } else { white }, stroke: 0.5pt + black))
    }
    for (i, t) in ticks.enumerate() {
      place(dx: width * i / 2 - 1cm, dy: 5.5pt, box(width: 2cm, align(center, text(font: sans, size: 6.5pt, t))))
    }
  })
}

#let map-figure(f) = {
  // The map's own lettering is set ragged and unhyphenated: a class name or a
  // datum broken across lines, or spaced out to a justified width, is not
  // read as one label.
  set par(justify: false)
  set text(hyphenate: false)
  let pixelated = field(f, "pixelated") == true
  let m = if "map" in f { f.map } else { none }
  let body = if m == none {
    // No extent: the raster as drawn, with its legend; nothing cartographic
    // can be stated about it, and the caption says so.
    let width = calc.min(text-width, map-height * f.aspect)
    stack(spacing: 0.5em,
      image(f.file, width: width, scaling: if pixelated { "pixelated" } else { "smooth" }),
      if has-legend(f) { box(width: width, legend-box(f)) })
  } else {
    let mx = 0.55cm
    let my = 0.45cm
    let tick = 3pt
    let W = calc.min(text-width - 2 * mx, map-height * f.aspect)
    let H = W / f.aspect
    let lab(s) = text(font: sans, size: 6pt, s)
    let sheet = box(width: W + 2 * mx, height: H + 2 * my, {
      place(dx: mx, dy: my, box(width: W, height: H, clip: true,
        image(f.file, width: W, height: H, fit: "stretch", scaling: if pixelated { "pixelated" } else { "smooth" })))
      place(dx: mx, dy: my, rect(width: W, height: H, stroke: 0.7pt + black))
      // Crosses where a meridian meets a parallel.
      for x in m.graticule.lon {
        for y in m.graticule.lat {
          let cx = mx + x.at * W
          let cy = my + y.at * H
          place(dx: cx - 3.5pt, dy: cy, line(length: 7pt, stroke: 0.45pt + black))
          place(dx: cx, dy: cy - 3.5pt, line(length: 7pt, angle: 90deg, stroke: 0.45pt + black))
        }
      }
      // Meridians: ticks and labels above and below the frame.
      for t in m.graticule.lon {
        let x = mx + t.at * W
        place(dx: x, dy: my - tick, line(length: tick, angle: 90deg, stroke: 0.5pt))
        place(dx: x, dy: my + H, line(length: tick, angle: 90deg, stroke: 0.5pt))
        place(dx: x - 1.5cm, dy: 0pt, box(width: 3cm, height: my - tick - 1pt, align(center + bottom, lab(t.label))))
        place(dx: x - 1.5cm, dy: my + H + tick + 1pt, box(width: 3cm, align(center + top, lab(t.label))))
      }
      // Parallels: ticks and labels left and right, read upwards.
      for t in m.graticule.lat {
        let y = my + t.at * H
        place(dx: mx - tick, dy: y, line(length: tick, stroke: 0.5pt))
        place(dx: mx + W, dy: y, line(length: tick, stroke: 0.5pt))
        place(dx: 0pt, dy: y - 1.5cm,
          box(width: mx - tick - 1pt, height: 3cm, align(right + horizon, rotate(-90deg, reflow: true, lab(t.label)))))
        place(dx: mx + W + tick + 1pt, dy: y - 1.5cm,
          box(width: mx - tick - 1pt, height: 3cm, align(left + horizon, rotate(-90deg, reflow: true, lab(t.label)))))
      }
    })
    let denominator = m.ground_width_m / (W / 1cm / 100)
    let elements = stack(spacing: 0.55em,
      align(center, north-arrow),
      align(center, scale-bar(m.scale_bar.fraction * W, m.scale_bar.ticks)),
      align(center, text(font: sans, size: 7pt)[Scale 1:#scale-denominator(denominator)]),
      align(center, text(font: sans, size: 6pt, fill: waiouru, m.crs)))
    stack(spacing: 0.45em,
      sheet,
      pad(x: mx, box(width: W, grid(
        columns: if has-legend(f) { (1fr, 4.6cm) } else { (1fr,) },
        column-gutter: 0.5cm,
        ..if has-legend(f) {
          (legend-box(f, columns: if W - 5.1cm >= 7.5cm and f.legend.len() > 3 { 2 } else { 1 }), elements)
        } else { (align(center, box(width: 4.6cm, elements)),) }))),
      pad(x: mx, box(width: W, align(left, text(font: sans, size: 6pt, fill: waiouru)[
        Source: #field(f, "source"). Map: TERRA #field(meta, "app_version"), #field(meta, "issued").]))))
  }
  // Floated, as LaTeX floats a figure: a map that does not fit under the text
  // above it goes to the my of the next page, and the text continues here
  // instead of leaving the rest of this page empty.
  figure(body, kind: image, placement: auto,
    caption: figure.caption(position: bottom)[*#f.title* #field(f, "caption")])
}

// A series drawn from the points it is given, in axis units the frontend
// chose: x in days from its own origin, y in the index's own unit.
#let series-figure(s) = {
  let w = 14.5cm
  let h = 5cm
  let (x0, x1) = s.x_range
  let (y0, y1) = s.y_range
  let px(x) = w * (x - x0) / (x1 - x0)
  let py(y) = h * (1 - (y - y0) / (y1 - y0))
  let plot = box(width: w, height: h, {
    for t in s.y_ticks {
      place(dx: 0pt, dy: py(t.at), line(length: w, stroke: 0.3pt + luma(88%)))
      place(dx: -0.25cm - 1.2cm, dy: py(t.at) - 0.45em,
        box(width: 1.2cm, align(right, text(font: sans, size: 6.5pt, t.label))))
    }
    for t in s.x_ticks {
      place(dx: px(t.at), dy: h, line(length: 3pt, angle: 90deg, stroke: 0.6pt))
      place(dx: px(t.at) - 1cm, dy: h + 5pt, box(width: 2cm, align(center, text(font: sans, size: 6.5pt, t.label))))
    }
    for m in s.marks {
      place(dx: px(m.x), dy: 0pt, line(length: h, angle: 90deg, stroke: (paint: rgb("#D55E00"), thickness: 0.7pt, dash: "dashed")))
      place(dx: px(m.x) + 2pt, dy: 1pt, text(font: sans, size: 6.5pt, fill: rgb("#D55E00"), m.label))
    }
    if s.points.len() > 1 {
      place(curve(stroke: 1pt + rgb("#0072B2"),
        curve.move((px(s.points.at(0).x), py(s.points.at(0).y))),
        ..s.points.slice(1).map(p => curve.line((px(p.x), py(p.y))))))
    }
    for p in s.points {
      place(dx: px(p.x) - 1.6pt, dy: py(p.y) - 1.6pt, circle(radius: 1.6pt, fill: rgb("#0072B2")))
    }
    place(dx: 0pt, dy: 0pt, line(length: h, angle: 90deg, stroke: 0.6pt))
    place(dx: 0pt, dy: h, line(length: w, stroke: 0.6pt))
  })
  let body = pad(left: 1.5cm, bottom: 0.9cm, top: 0.2cm, {
    plot
    place(dx: -1.45cm, dy: -h / 2 - 1.2cm, rotate(-90deg, reflow: true, text(font: sans, size: 7pt, s.y_label)))
    place(dx: w / 2 - 2cm, dy: 0.45cm, box(width: 4cm, align(center, text(font: sans, size: 7pt, s.x_label))))
  })
  figure(body, kind: image, placement: auto,
    caption: figure.caption(position: bottom)[*#s.title* #field(s, "caption")])
}

#let data-table(t) = {
  let aligns = t.columns.map(c => if field(c, "align") == "right" { right } else { left })
  figure(kind: table, caption: figure.caption(position: top)[*#t.title* #field(t, "caption")], {
    set text(size: 8pt)
    set par(justify: false)
    table(
      columns: t.columns.len(),
      align: aligns,
      stroke: none,
      inset: (x: 4pt, y: 3.2pt),
      table.hline(stroke: 0.8pt + trim),
      table.header(..t.columns.map(c => text(font: sans, weight: "bold", size: 7.5pt, c.label))),
      table.hline(stroke: 0.4pt + trim),
      ..t.rows.flatten(),
      table.hline(stroke: 0.8pt + trim),
    )
  })
}
#show figure.where(kind: table): set block(breakable: true)
// Captions set flush left: a centred caption of two or three lines leaves
// ragged edges on both sides.
#show figure.caption: set text(size: 8.5pt)
#show figure.caption: set align(left)
#show figure.caption: set par(justify: false)

#if has("figures") or has("series") or has("tables") {
  heading[Results]
  for f in field(doc, "figures") { map-figure(f) }
  for s in field(doc, "series") { series-figure(s) }
  for t in field(doc, "tables") { data-table(t) }
}

#if has("limitations") {
  heading[Limitations]
  for l in doc.limitations {
    limit[#text(font: sans, weight: "bold", size: 8.5pt, fill: warrior, l.label) \ #l.text]
  }
}

#if has("runs") {
  heading[Reproducibility]
  data-table((
    title: "Runs this report reads.",
    caption: "Each identifier is the run's key in the local store; the project file (.terra) carries the same runs.",
    columns: ((label: "Run"), (label: "Product"), (label: "Period"), (label: "Created (UTC)")),
    rows: doc.runs.map(r => (raw(r.id), r.kind, field(r, "period"), field(r, "created"))),
  ))
  text(size: 9pt)[Generated by TERRA #field(meta, "app_version") at #field(meta, "generated_at") UTC.]
}

#if has("references") {
  heading(numbering: none)[References]
  set par(hanging-indent: 1.2em, justify: false)
  set text(size: 8.5pt)
  for r in doc.references { par(r) }
}
