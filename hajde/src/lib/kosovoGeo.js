/**
 * Approximate municipality centres (for "near me" when the browser location is
 * not shared, and for teachers who only pick a city). Precision ~1 km is enough.
 */
export const CITY_COORDS = {
  'Prishtinë': [42.6629, 21.1655], 'Prizren': [42.2139, 20.7397], 'Pejë': [42.6593, 20.2887], 'Gjakovë': [42.3803, 20.4308],
  'Mitrovicë': [42.8914, 20.866], 'Ferizaj': [42.3702, 21.1553], 'Gjilan': [42.4635, 21.4694], 'Podujevë': [42.9106, 21.1933],
  'Vushtrri': [42.8231, 20.9675], 'Suharekë': [42.358, 20.825], 'Rahovec': [42.3992, 20.6547], 'Drenas': [42.6253, 20.8936],
  'Lipjan': [42.5217, 21.1225], 'Malishevë': [42.4828, 20.7458], 'Kamenicë': [42.5781, 21.5803], 'Viti': [42.3214, 21.3583],
  'Deçan': [42.5402, 20.288], 'Istog': [42.7808, 20.4875], 'Klinë': [42.6211, 20.5775], 'Skenderaj': [42.7467, 20.7886],
  'Dragash': [42.0625, 20.6533], 'Fushë Kosovë': [42.6381, 21.0961], 'Obiliq': [42.6869, 21.0703], 'Shtime': [42.4331, 21.0397],
  'Kaçanik': [42.2319, 21.2592], 'Junik': [42.4761, 20.2775], 'Hani i Elezit': [42.15, 21.2967], 'Mamushë': [42.3253, 20.7253],
  'Graçanicë': [42.5978, 21.1936], 'Shtërpcë': [42.2392, 21.0272], 'Novobërdë': [42.6111, 21.4319], 'Kllokot': [42.37, 21.38],
  'Ranillug': [42.4919, 21.6], 'Partesh': [42.4019, 21.4336], 'Zubin Potok': [42.9147, 20.6897], 'Zveçan': [42.9075, 20.8408],
  'Leposaviq': [43.1039, 20.8025], 'Mitrovicë e Veriut': [42.895, 20.865],
}

export const coordsOf = (city) => CITY_COORDS[city] || null
