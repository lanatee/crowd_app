import React, { useEffect, useRef, useState } from "react";
import axios from "axios";

// 혼잡도 → 색상
const levelColor = (lvl) => {
  switch (lvl) {
    case "여유":
      return "#2e7d32";
    case "보통":
      return "#1976d2";
    case "약간 붐빔":
      return "#f57c00";
    case "매우 붐빔":
      return "#d32f2f";
    case "혼잡":
    case "매우 혼잡":
      return "#d32f2f";
    default:
      return "#444";
  }
};
const API_BASE = process.env.REACT_APP_API_BASE_URL || "https://crowdservice-seoul.onrender.com";
const KAKAO_APP_KEY = "4be286df1e9ff528c5bc9a5cdbf1303e"; // 필요시 .env로 이동

export default function MapPage() {
  const markersRef = useRef([]);
  const [statusMsg, setStatusMsg] = useState("혼잡도 불러오는 중…");

  useEffect(() => {
    // Kakao SDK 로드
    const script = document.createElement("script");
    script.async = true;
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_APP_KEY}&autoload=false`;
    document.head.appendChild(script);

    script.onload = () => {
      window.kakao.maps.load(() => {
        const container = document.getElementById("map");
        if (!container) return;

        // 서울 경계
        const SW = new window.kakao.maps.LatLng(37.413294, 126.734086);
        const NE = new window.kakao.maps.LatLng(37.715133, 127.269311);
        const SEOUL_BOUNDS = new window.kakao.maps.LatLngBounds(SW, NE);

        // 지도
        const map = new window.kakao.maps.Map(container, {
          center: new window.kakao.maps.LatLng(37.5665, 126.9780),
          level: 5,
        });
        map.setBounds(SEOUL_BOUNDS);
        map.setMinLevel(5);
        map.setMaxLevel(8);

        // 줌 컨트롤
        const zoomControl = new window.kakao.maps.ZoomControl();
        map.addControl(zoomControl, window.kakao.maps.ControlPosition.RIGHT);

        // 공용 인포윈도우 (하나만 사용)
        const info = new window.kakao.maps.InfoWindow({ zIndex: 2 });
        window.kakao.maps.event.addListener(map, "click", () => info.close());

        // 마커 정리
        const clearMarkers = () => {
          markersRef.current.forEach((m) => m.setMap && m.setMap(null));
          markersRef.current = [];
        };

        // 마커 렌더
        // const renderMarkers = (items) => {
        //   clearMarkers();

        //   let shown = 0;
        //   items.forEach((spot) => {
        //     const lat = Number(spot.lat);
        //     const lng = Number(spot.lon);
        //     if (Number.isNaN(lat) || Number.isNaN(lng)) return;

        //     const pos = new window.kakao.maps.LatLng(lat, lng);
        //     const marker = new window.kakao.maps.Marker({ position: pos, map, title: spot.name });

        //     const html = `
        //       <div style="min-width:220px;padding:8px;font-family:-apple-system,Segoe UI,Roboto,Noto Sans KR,sans-serif">
        //         <div style="font-weight:700;margin-bottom:4px">${escapeHtml(spot.name || "")}</div>
        //         <div style="font-size:12px;color:#555">혼잡도:
        //           <span style="color:${levelColor(spot.area_congest_lvl)};font-weight:700">
        //             ${escapeHtml(spot.area_congest_lvl || "")}
        //           </span>
        //         </div>
        //         <div style="font-size:12px;color:#555">
        //           추정 인원: ${Number(spot.area_ppltn_min || 0).toLocaleString()} ~ ${Number(spot.area_ppltn_max || 0).toLocaleString()}
        //         </div>
        //         <div style="font-size:11px;color:#888;margin-top:4px">
        //           업데이트: ${escapeHtml(spot.updated_at || "")}
        //         </div>
        //       </div>
        //     `;

        //     window.kakao.maps.event.addListener(marker, "click", () => {
        //       info.setContent(html);     // 내용 교체
        //       info.open(map, marker);    // 하나만 열림(기존은 자동 대체)
        //       // map.setCenter(pos);     // 필요하면 주석 해제해 클릭 시 중앙 이동
        //     });

        //     markersRef.current.push(marker);
        //     shown++;
        //   });

        //   setStatusMsg(`✅ 혼잡도 ${shown}개 불러오기 성공`);
        // };

        const renderMarkers = (items) => {
          clearMarkers();

          let shown = 0;
          items.forEach((spot) => {
            const lat = Number(spot.lat);
            const lng = Number(spot.lon);
            if (Number.isNaN(lat) || Number.isNaN(lng)) return;

            const pos = new window.kakao.maps.LatLng(lat, lng);
            const marker = new window.kakao.maps.Marker({ position: pos, map, title: spot.name });

            // 🔹 fcst HTML 추가
            let fcstHtml = "";
            if (Array.isArray(spot.fcst) && spot.fcst.length > 0) {
              fcstHtml = `
                <div style="font-size:11px;color:#555;margin-top:6px;">
                  <strong>예측 혼잡도</strong>
                  <ul style="margin:4px 0 0 0;padding:0;list-style:none;max-height:120px;overflow-y:auto;">
                    ${spot.fcst
                      .map(
                        (f) => `
                        <li style="margin-bottom:2px;">
                          ${new Date(f.fcst_time).getHours()}시 :
                          <span style="color:${levelColor(f.fcst_congest_lvl)};font-weight:700">
                            ${escapeHtml(f.fcst_congest_lvl)}
                          </span>
                          (${Number(f.fcst_ppltn_min).toLocaleString()} ~ ${Number(f.fcst_ppltn_max).toLocaleString()})
                        </li>`
                      )
                      .join("")}
                  </ul>
                </div>
              `;
            }

            // 🔹 원래 html + fcstHtml 추가
            const html = `
              <div style="min-width:220px;padding:8px;font-family:-apple-system,Segoe UI,Roboto,Noto Sans KR,sans-serif">
                <div style="font-weight:700;margin-bottom:4px">${escapeHtml(spot.name || "")}</div>
                <div style="font-size:12px;color:#555">혼잡도:
                  <span style="color:${levelColor(spot.area_congest_lvl)};font-weight:700">
                    ${escapeHtml(spot.area_congest_lvl || "")}
                  </span>
                </div>
                <div style="font-size:12px;color:#555">
                  추정 인원: ${Number(spot.area_ppltn_min || 0).toLocaleString()} ~ ${Number(spot.area_ppltn_max || 0).toLocaleString()}
                </div>
                <div style="font-size:11px;color:#888;margin-top:4px">
                  업데이트: ${escapeHtml(spot.updated_at || "")}
                </div>
                ${fcstHtml}
              </div>
            `;

            window.kakao.maps.event.addListener(marker, "click", () => {
              info.setContent(html);     // 내용 교체
              info.open(map, marker);    // 하나만 열림
            });

            markersRef.current.push(marker);
            shown++;
          });

          setStatusMsg(`✅ 혼잡도 ${shown}개 불러오기 성공`);
        };

        // 🔔 API 호출 (프록시 사용 시 상대경로 /congestion)
        axios.get(`${API_BASE}/congestion?include_fcst=true`)
        //axios.get("/congestion?include_fcst=true")
          .then((res) => {
            const data = res.data;
            if (!data?.ok || !Array.isArray(data.items)) {
              setStatusMsg("❌ 혼잡도 불러오기 실패 (데이터 형식 오류)");
              return;
            }
            renderMarkers(data.items);
          })
          .catch((error) => {
            if (error.response) {
              setStatusMsg(`❌ 혼잡도 불러오기 실패 (서버 응답: ${error.response.status})`);
            } else if (error.request) {
              setStatusMsg("❌ 혼잡도 불러오기 실패 (응답 없음: 네트워크 문제 또는 CORS)");
            } else {
              setStatusMsg(`❌ 혼잡도 불러오기 실패 (오류: ${error.message})`);
            }
            console.error("혼잡도 API 호출 실패:", error);
          });
      });
    };

    return () => {
      markersRef.current.forEach((m) => m.setMap && m.setMap(null));
      markersRef.current = [];
      document.head.removeChild(script);
    };
  }, []);

  


  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <h1 style={{ margin: "12px 0 4px" }}>서울 관광지 혼잡도 지도</h1>
      <p style={{ margin: "0 0 8px", fontSize: 14, color: "#555" }}>{statusMsg}</p>

      {/* 지도는 남은 높이 전부 */}
      <div id="map" style={{ flex: "1 1 auto", width: "100%" }} />
    </div>
  );
}

// 간단 XSS 방지
function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
