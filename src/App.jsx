import React, { useEffect } from "react";
import axios from "axios";

const MapPage = () => {
  useEffect(() => {
    const script = document.createElement("script");
    script.async = true;
    script.src =
      "//dapi.kakao.com/v2/maps/sdk.js?appkey=4be286df1e9ff528c5bc9a5cdbf1303e&autoload=false";
    document.head.appendChild(script);

    script.onload = () => {
      window.kakao.maps.load(() => {
        const container = document.getElementById("map");

        // ✅ 서울 대략 경계(남서/북동 모서리)
        const SEOUL_SW = new window.kakao.maps.LatLng(37.413294, 126.734086);
        const SEOUL_NE = new window.kakao.maps.LatLng(37.715133, 127.269311);
        const SEOUL_BOUNDS = new window.kakao.maps.LatLngBounds(SEOUL_SW, SEOUL_NE);

        // 1) 지도 생성 후 곧바로 서울 영역으로 맞추기
        const map = new window.kakao.maps.Map(container, {
          center: new window.kakao.maps.LatLng(37.5665, 126.9780), // 서울시청
          level: 8,
        });
        map.setBounds(SEOUL_BOUNDS); // 서울 영역에 맞게 카메라 조정

        // (선택) 너무 넓게/깊게 못 가게 줌 한계 설정
        map.setMinLevel(7); // 더 넓게(멀리) 못가게
        map.setMaxLevel(12); // 너무 깊게(가깝게) 못가게

        // 2) 관광지 불러와서 "서울 범위 안"만 마커 표시
        axios
          .get("http://localhost:8080/tourist-spots")
          .then((response) => {
            const spots = Array.isArray(response.data) ? response.data : response.data.spots;

            if (!Array.isArray(spots)) {
              console.error("❌ 관광지 데이터가 배열이 아닙니다:", spots);
              return;
            }

            // 서울 안인지 판단하는 헬퍼
            const isInSeoul = (lat: number, lng: number) =>
              lat >= SEOUL_SW.getLat() &&
              lat <= SEOUL_NE.getLat() &&
              lng >= SEOUL_SW.getLng() &&
              lng <= SEOUL_NE.getLng();

            spots.forEach((spot) => {
              const lat = parseFloat(spot.mapy);
              const lng = parseFloat(spot.mapx);
              if (Number.isNaN(lat) || Number.isNaN(lng)) return;
              if (!isInSeoul(lat, lng)) return; // ✅ 서울 밖이면 스킵

              const pos = new window.kakao.maps.LatLng(lat, lng);
              const marker = new window.kakao.maps.Marker({
                position: pos,
                map,
                title: spot.title,
              });

              const infowindow = new window.kakao.maps.InfoWindow({
                content: `<div style="padding:5px;">${spot.title}</div>`,
              });
              window.kakao.maps.event.addListener(marker, "click", () =>
                infowindow.open(map, marker)
              );
            });
          })
          .catch((error) => {
            console.error("관광지 목록 불러오기 실패:", error);
          });
      });
    };

    return () => {
      document.head.removeChild(script);
    };
  }, []);

  return (
    <div>
      <h1>관광지111 지도 (서울만)</h1>
      <div id="map" style={{ width: "100%", height: "600px" }} />
    </div>
  );
};

export default MapPage;
