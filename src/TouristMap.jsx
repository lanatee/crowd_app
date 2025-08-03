import { Map, MapMarker } from "react-kakao-maps-sdk";
import axios from "axios";
import { useEffect, useState } from "react";

function TouristMap() {
  const [places, setPlaces] = useState([]);

    useEffect(() => {
    axios.get("http://localhost:8080/get-tourist-spots")
        .then(response => {
        console.log("✅ 받아온 관광지:", response.data); // 🔍 여기에 찍히는지 확인
        setPlaces(response.data);
        })
        .catch(error => {
        console.error("❌ 관광지 가져오기 실패:", error);
        });
    }, []);

  return (
    <Map
      center={{ lat: 36.5, lng: 127.5 }}
      style={{ width: "100%", height: "90vh" }}
      level={13}
    >
      {places.map((place) => (
        <MapMarker
          key={place.content_id}
          position={{ lat: place.mapy, lng: place.mapx }}
        >
          <div>{place.title}</div>
        </MapMarker>
      ))}
    </Map>
  );
}

export default TouristMap;
