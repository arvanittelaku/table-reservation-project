export const MUNICIPALITIES = [
  { name: 'Prishtinë', lat: 42.6629, lng: 21.1655 },
  { name: 'Prizren', lat: 42.2139, lng: 20.7397 },
  { name: 'Pejë', lat: 42.6591, lng: 20.2883 },
  { name: 'Gjakovë', lat: 42.3803, lng: 20.4310 },
  { name: 'Mitrovicë', lat: 42.8914, lng: 20.8660 },
  { name: 'Ferizaj', lat: 42.3703, lng: 21.1553 },
  { name: 'Gjilan', lat: 42.4634, lng: 21.4694 },
  { name: 'Podujevë', lat: 42.9106, lng: 21.1925 },
  { name: 'Vushtrri', lat: 42.8231, lng: 20.9678 },
  { name: 'Suharekë', lat: 42.3597, lng: 20.8256 },
]

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function nearestMunicipality(lat, lng) {
  let best = MUNICIPALITIES[0]
  let bestDist = Infinity
  for (const m of MUNICIPALITIES) {
    const d = haversine(lat, lng, m.lat, m.lng)
    if (d < bestDist) { bestDist = d; best = m }
  }
  return best.name
}
