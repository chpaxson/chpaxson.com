#import "@preview/cetz:0.5.2": *
#import "@preview/cetz:0.5.2": *


#let convert(value) = {
  if type(value) == length {
    return value/1cm
  }
  return value
}

// d = diameter of the screw
// l = length of the screw
// p = pitch of the screw
// hd = head diameter
// hh = head height
// hw = head width (for hex head cap screw)

#let BHCS(d, l, p, hd, hh) = draw.group({
  (d, l, p, hd, hh) = (d, l, p, hd, hh).map(x => convert(x))
  let c = p * 0.75
  
  let x2 = hh*0.85
  let y2 = hd/2
  let cx = -(d*d/4 - x2*x2 - y2*y2) / (2*x2)
  let r = calc.sqrt(cx*cx + d*d/4)
  let x3 = x2/2
  let y3 = calc.sqrt(r*r - calc.pow(x3 - cx, 2))
  import draw: *
  set-style(stroke: 0.75pt + black, cap: "round", join: "round")
  group({
    translate(x: -hh)
    merge-path(close: true, {
      line((0,-d/2), (0,d/2))
      arc-through((0,d/2), (x3, y3), (x2, y2))
      line((), (hh, hd/2), (hh, -hd/2))
      arc-through((), (x3, -y3), (0, -d/2))
    })
  })
  line((0,d/2), (l -c, d/2), (l, d/2 -c), (l, -d/2 + c), (l -c, -d/2), (0, -d/2))
})
#let SHCS(d, l, p, hd, hh) = draw.group({
  (d, l, p, hd, hh) = (d, l, p, hd, hh).map(x => convert(x))
  let c = p * 0.75
  let c2 = hd * 0.05
  import draw: *
  set-style(stroke: 0.75pt + black, cap: "round", join: "round")
  line((0,d/2), (l -c, d/2), (l, d/2 -c), (l, -d/2 + c), (l -c, -d/2), (0, -d/2))
  line(
    (0, hd/2 - c2), (-c2, hd/2), (-hh + c2, hd/2), (-hh, hd/2 - c2), (-hh, -hd/2 + c2),
    (-hh + c2, -hd/2), (-c2, -hd/2), (0, -hd/2 + c2), close: true
  )
})

#let FHCS(d, l, p, hd, ha: 90deg) = draw.group({
  import draw: *
  (d, l, p, hd) = (d, l, p, hd).map(x => convert(x))
  let (hh, c, c2) = ((hd -d) / (2*calc.cos(ha/2)), p * 0.75, hd * 0.05)
  set-style(stroke: 0.75pt + black, cap: "round", join: "round")
  line(
    (0,hd/2), (hh,d/2), (l -c, d/2), (l, d/2 -c),
    (l, -d/2 + c), (l -c, -d/2), (hh, -d/2), (0, -hd/2),
    close: true
  )
  line((hh,d/2), (hh,-d/2))
})

// hex head cap screw
#let HHCS(d, l, p, hw, hh) = draw.group({
  import draw: *
  (d, l, p, hw, hh) = (d, l, p, hw, hh).map(x => convert(x))
  let hd = hw * 2 / calc.sqrt(3)
  let c = p * 0.75
  let c2 = hd * 0.05

  import draw: *
  set-style(stroke: 0.75pt + black, cap: "round", join: "round")
  line((0,d/2), (l -c, d/2), (l, d/2 -c), (l, -d/2 + c), (l -c, -d/2), (0, -d/2))
  line(
    (0, hd/2 - c2), (-c2, hd/2), (-hh + c2, hd/2), (-hh, hd/2 - c2), (-hh, -hd/2 + c2),
    (-hh + c2, -hd/2), (-c2, -hd/2), (0, -hd/2 + c2), close: true 
  )
  set-style(stroke: 0.5pt)
  line((0,hd/4), (rel: (c2 -hh, 0)))
  anchor("a", ())
  line("a", (rel: (-c2, c2)))
  line("a", (rel: (-c2, -c2)))
  line((0,-hd/4), (rel: (c2 -hh, 0)))
  anchor("a", ())
  line("a", (rel: (-c2, c2)))
  line("a", (rel: (-c2, -c2)))
})



// hex head cap screw
#let heatset-insert(od1, od2, l, kl, kg, p, hw, hh) = draw.group({
  import draw: *
  // (d, l, p, hw, hh) = (d, l, p, hw, hh).map(x => convert(x))
  // let hd = hw * 2 / calc.sqrt(3)
  // let c = p * 0.75
  // let c2 = hd * 0.05

  import draw: *
  set-style(stroke: 0.75pt + black, cap: "round", join: "round")

  
  
})
#set page(
  width: 52mm,
  height: 0.5in,
  margin: (x: 0mm, y: 0.25mm),

)

#set align(center + horizon)
#set text(font: "Lato", size: 2.5mm, weight: 700)
#set par(leading: 0.75mm)

#let headerFont = 3.5mm
#let textFont = 2.75mm

#let screw-db = (
  "SHCS": (
    "2mm": (p: 0.4, hd: 4.5, hh: 2.5),
    "2.5mm": (p: 0.45, hd: 5, hh: 2.75),
    "3mm": (p: 0.5, hd: 5.5, hh: 3),
    "3.5mm": (p: 0.6, hd: 6, hh: 3.5),
    "4mm": (p: 0.7, hd: 7, hh: 4),
    "5mm": (p: 0.8, hd: 8, hh: 5),
    "6mm": (p: 1, hd: 10, hh: 6),
    "8mm": (p: 1.25, hd: 13, hh: 8),
  ),
  "BHCS": (
    "2mm": (p: 0.4, hd: 4.5, hh: 2.5),
    "2.5mm": (p: 0.45, hd: 5, hh: 2.75),
    "3mm": (p: 0.5, hd: 5.5, hh: 3),
    "3.5mm": (p: 0.6, hd: 6, hh: 3.5),
    "4mm": (p: 0.7, hd: 7, hh: 4),
    "5mm": (p: 0.8, hd: 8, hh: 5),
    "6mm": (p: 1, hd: 10, hh: 6),
    "8mm": (p: 1.25, hd: 13, hh: 8),
  ),
  "FHCS": (
    "2mm": (p: 0.4, hd: 4.5, hh: 2.5),
    "2.5mm": (p: 0.45, hd: 5, hh: 2.75),
    "3mm": (p: 0.5, hd: 5.5, hh: 3),
    "3.5mm": (p: 0.6, hd: 6, hh: 3.5),
    "4mm": (p: 0.7, hd: 7, hh: 4),
    "5mm": (p: 0.8, hd: 8, hh: 5),
    "6mm": (p: 1, hd: 10, hh: 6),
    "8mm": (p: 1.25, hd: 13, hh: 8),
  ),
  "HHCS": (
    "2mm": (p: 0.4, hd: 4.5, hh: 2.5),
    "2.5mm": (p: 0.45, hd: 5, hh: 2.75),
    "3mm": (p: 0.5, hd: 5.5, hh: 3),
    "3.5mm": (p: 0.6, hd: 6, hh: 3.5),
    "4mm": (p: 0.7, hd: 7, hh: 4),
    "5mm": (p: 0.8, hd: 8, hh: 5),
    "6mm": (p: 1, hd: 10, hh: 6),
    "8mm": (p: 1.25, hd: 13, hh: 8),
  ),
)

#let screw-fig(l, size, type) = {
  let vals = screw-db.at(type).at(str(size) + "mm")
  if type == "SHCS" {
    return SHCS(size, l, vals.p, vals.hd, vals.hh)
  } else if type == "BHCS" {
    return BHCS(size, l, vals.p, vals.hd, vals.hh)
  } else if type == "FHCS" {
    return FHCS(size, l, vals.p, vals.hd, vals.hh)
  } else if type == "HHCS" {
    return HHCS(size, l, vals.p, vals.hd, vals.hh)
  }
}

#let short-fig(l1, l2, size: 3, type: "SHCS", f: 1.1) = {
  let figs = none

  if l1 + l2 < 40 {
    figs = (
      canvas(length: 1mm, screw-fig(l1, size, type)),
      grid.vline(),
      canvas(length: 1mm, {
        draw.rotate(180deg)
        screw-fig(l2, size, type)
      })
    )
  } else {
    figs = (
      grid.cell(colspan: 2, canvas(length: 1mm, {
        import draw: *
        let vals = screw-db.at(type).at(str(size) + "mm")
        let head-size = vals.hd
        rotate(calc.atan((vals.hd -size)/(l1+l2)))
        screw-fig(l1, size, type)
        translate(x: f*(l1+l2)/2, y: -size -1)
        rotate(180deg)
        screw-fig(l2, size, type)
      })),
    )
  }

  grid(
    columns: (1fr, 1fr), row-gutter: 0.5mm, inset: 0mm,
    grid.cell(colspan: 2, inset: (x: 1mm, y: 0.3mm), grid(
      columns: (1fr, auto, 1fr),
      align: (left, center, right),
      text(size: textFont)[#l1 mm],
      text(size: headerFont)[_*M3 x 0.5mm #type*_],
      text(size: textFont)[#l2 mm],
    )),
  )
  v(1fr)
  grid(columns: (1fr, 1fr), ..figs)
}


#short-fig(3, 4, size: 3, type: "SHCS")
#short-fig(5, 6, size: 3, type: "SHCS")
#short-fig(8, 10, size: 3, type: "SHCS")
#short-fig(12, 14, size: 3, type: "SHCS")
#short-fig(16, 18, size: 3, type: "SHCS")
#short-fig(20, 22, size: 3, type: "SHCS")

#set text(size: 4mm)
#set page(width: auto, height: 0.5in, margin: (x: 5mm, y: 0mm))

#page[
  Small\ Protoboards
]

#page[
  Buck Converters\
  RTC Modules
]

#page[
  AS5600 Magnetic Encoders\
  Miscellaneous Sensors
]