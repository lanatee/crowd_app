import React, { useEffect } from 'react'

function MapPage() {
    useEffect(() => {
    // ✅ 1. 지도 띄우기
    const container = document.getElementById('map')
    const options = {
      center: new window.kakao.maps.LatLng(36.5, 127.8),
      level: 13,
    }
    const map = new window.kakao.maps.Map(container, options)

    // ✅ 2. 관광지 목록 불러오기 (백엔드 API 호출)
    fetch('http://localhost:8080/tourist-spots')
      .then(res => res.json())
      .then(data => {
        data.forEach(place => {
          const marker = new window.kakao.maps.Marker({
            map,
            position: new window.kakao.maps.LatLng(place.mapy, place.mapx),
          })

          const infowindow = new window.kakao.maps.InfoWindow({
            content: `<div style="padding:5px;">${place.title}</div>`
          })

          window.kakao.maps.event.addListener(marker, 'click', () => {
            infowindow.open(map, marker)
          })
        })
      })
      .catch(err => console.error('관광지 데이터 오류:', err))
  }, [])

  return (
    <div>
      <div id="map" style={{ width: '100%', height: '600px' }}></div>
    </div>
  )
}

export default MapPage