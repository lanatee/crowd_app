import React, { useEffect } from "react";
import axios from "axios";

const MapPage = () => {
  useEffect(() => {
    // 1. 카카오맵 스크립트 동적으로 로드
    const script = document.createElement("script");
    script.async = true;
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=4be286df1e9ff528c5bc9a5cdbf1303e&autoload=false`;
    document.head.appendChild(script);

    script.onload = () => {
      window.kakao.maps.load(() => {
        const container = document.getElementById("map");
        const options = {
          center: new window.kakao.maps.LatLng(36.5, 127.5), // 대한민국 중심 좌표
          level: 13,
        };

        const map = new window.kakao.maps.Map(container, options);

        // 2. 관광지 데이터 불러오기
        axios.get("http://localhost:8080/tourist-spots")
          .then((response) => {
            const spots = Array.isArray(response.data)
              ? response.data
              : response.data.spots;

            if (!Array.isArray(spots)) {
              console.error("❌ 관광지 데이터가 배열이 아닙니다:", spots);
              return;
            }

            // 3. 마커 표시
            spots.forEach((spot) => {
              const lat = parseFloat(spot.mapy);
              const lng = parseFloat(spot.mapx);

              if (!isNaN(lat) && !isNaN(lng)) {
                const markerPosition = new window.kakao.maps.LatLng(lat, lng);
                const marker = new window.kakao.maps.Marker({
                  position: markerPosition,
                  map: map,
                  title: spot.title,
                });

                const infowindow = new window.kakao.maps.InfoWindow({
                  content: `<div style="padding:5px;">${spot.title}</div>`,
                });

                window.kakao.maps.event.addListener(marker, "click", () => {
                  infowindow.open(map, marker);
                });
              }
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
      <h1>관광지 지도</h1>
      <div id="map" style={{ width: "100%", height: "600px" }}></div>
    </div>
  );
};

export default MapPage;
