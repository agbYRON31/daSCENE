import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Dimensions,
  SafeAreaView,
  StatusBar,
  Alert,
  ActivityIndicator,
} from "react-native";
import Icon from "react-native-vector-icons/MaterialIcons";
import { LineChart, BarChart } from "react-native-chart-kit";
import axios from "axios";

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

// API configuration
const API_BASE_URL = "http://localhost:3001/api";

const SceneAppComplete = () => {
  const [viewMode, setViewMode] = useState("customer");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [token, setToken] = useState(null); // JWT token for authenticated requests

  const AuthScreen = ({ onLogin }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [name, setName] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [viewMode, setViewMode] = useState("customer");
    const [token, setToken] = useState(null);

    // Check for existing token on app load
    useEffect(() => {
      const checkAuth = async () => {
        try {
          const storedToken = await SecureStore.getItemAsync("authToken");
          if (storedToken) {
            setToken(storedToken);
          }
        } catch (error) {
          console.error("Failed to load token", error);
        } finally {
          setLoading(false);
        }
      };

      checkAuth();
    }, []);

    if (loading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#f87171" />
        </View>
      );
    }

    if (!token) {
      return <AuthScreen onLogin={setToken} />;
    }

    const handleAuth = async () => {
      try {
        setLoading(true);
        setError("");

        const endpoint = isLogin ? "/auth/login" : "/auth/register";
        const payload = isLogin
          ? { email, password }
          : { email, password, name, role: "venue_manager" }; // or 'customer'

        const response = await axios.post(
          `${API_BASE_URL}${endpoint}`,
          payload
        );

        // Store token securely
        await SecureStore.setItemAsync("authToken", response.data.token);

        // Notify parent component
        onLogin(response.data.token);
      } catch (err) {
        setError(err.response?.data?.error || "Authentication failed");
      } finally {
        setLoading(false);
      }
    };

    return (
      <View style={styles.authContainer}>
        <Text style={styles.authTitle}>{isLogin ? "Login" : "Register"}</Text>

        {error ? <Text style={styles.authError}>{error}</Text> : null}

        <TextInput
          style={styles.authInput}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <TextInput
          style={styles.authInput}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {!isLogin && (
          <TextInput
            style={styles.authInput}
            placeholder="Name"
            value={name}
            onChangeText={setName}
          />
        )}

        <TouchableOpacity
          style={styles.authButton}
          onPress={handleAuth}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.authButtonText}>
              {isLogin ? "Login" : "Register"}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.authToggle}
          onPress={() => setIsLogin(!isLogin)}
        >
          <Text style={styles.authToggleText}>
            {isLogin
              ? "Don't have an account? Register"
              : "Already have an account? Login"}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  // Customer App Component
  const SceneApp = () => {
    const [activeTab, setActiveTab] = useState("map");
    const [venues, setVenues] = useState([]);
    const [userCheckedIn, setUserCheckedIn] = useState(null);
    const [selectedVenue, setSelectedVenue] = useState(null);
    const [photos, setPhotos] = useState([]);
    const [userProfile, setUserProfile] = useState(null);

    // Fetch venues from API
    const fetchVenues = async () => {
      try {
        setLoading(true);
        const response = await axios.get(`${API_BASE_URL}/venues`);
        setVenues(response.data.data);
      } catch (err) {
        setError(err.response?.data?.error || "Failed to fetch venues");
      } finally {
        setLoading(false);
      }
    };

    // Fetch photos from API
    const fetchPhotos = async () => {
      try {
        setLoading(true);
        const response = await axios.get(`${API_BASE_URL}/photos`);
        setPhotos(response.data);
      } catch (err) {
        setError(err.response?.data?.error || "Failed to fetch photos");
      } finally {
        setLoading(false);
      }
    };

    // Fetch user profile from API
    const fetchUserProfile = async () => {
      try {
        setLoading(true);
        const response = await axios.get(`${API_BASE_URL}/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setUserProfile(response.data);
      } catch (err) {
        setError(err.response?.data?.error || "Failed to fetch profile");
      } finally {
        setLoading(false);
      }
    };

    // Handle check-in
    const handleCheckIn = async (venueId, latitude, longitude) => {
      try {
        setLoading(true);
        const response = await axios.post(
          `${API_BASE_URL}/checkins`,
          { venueId, latitude, longitude },
          { headers: { Authorization: `Bearer ${token}` } }
        );

        setUserCheckedIn(venueId);
        fetchVenues(); // Refresh venues data
      } catch (err) {
        setError(err.response?.data?.error || "Failed to check in");
      } finally {
        setLoading(false);
      }
    };

    // Handle check-out
    const handleCheckOut = async (checkinId) => {
      try {
        setLoading(true);
        await axios.post(
          `${API_BASE_URL}/checkins/${checkinId}/checkout`,
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );

        setUserCheckedIn(null);
        fetchVenues(); // Refresh venues data
      } catch (err) {
        setError(err.response?.data?.error || "Failed to check out");
      } finally {
        setLoading(false);
      }
    };

    // Load data on component mount
    useEffect(() => {
      fetchVenues();
      fetchPhotos();
      if (token) fetchUserProfile();
    }, [token]);

    // Map component with real data
    const SceneMap = () => (
      <View style={styles.mapContainer}>
        {loading ? (
          <ActivityIndicator size="large" color="#f87171" />
        ) : (
          <>
            <View style={styles.mapBackground}>
              {venues.map((venue, index) => (
                <TouchableOpacity
                  key={venue.id}
                  style={[
                    styles.mapPin,
                    {
                      left: `${20 + index * 25}%`,
                      top: `${30 + index * 20}%`,
                    },
                  ]}
                  onPress={() => setSelectedVenue(venue)}
                >
                  <View
                    style={[
                      styles.pinCircle,
                      {
                        backgroundColor:
                          venue.sceneScore > 9
                            ? "#ef4444"
                            : venue.sceneScore > 8
                            ? "#dc2626"
                            : "#b91c1c",
                      },
                    ]}
                  >
                    <Icon name="people" size={24} color="white" />
                  </View>
                  <View style={styles.pinBadge}>
                    <Text style={styles.pinBadgeText}>
                      {venue.currentCheckins}
                    </Text>
                  </View>
                  <View style={styles.scoreDisplay}>
                    <Text style={styles.scoreText}>{venue.sceneScore}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            <Modal
              visible={selectedVenue !== null}
              transparent={true}
              animationType="slide"
            >
              <View style={styles.modalOverlay}>
                <View style={styles.venueModal}>
                  <View style={styles.modalHeader}>
                    <View>
                      <Text style={styles.venueTitle}>
                        {selectedVenue?.name}
                      </Text>
                      <Text style={styles.venueSubtitle}>
                        {selectedVenue?.location} • {selectedVenue?.distance}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => setSelectedVenue(null)}>
                      <Icon name="close" size={24} color="#f87171" />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.venueStats}>
                    <View style={styles.statItem}>
                      <Icon name="star" size={20} color="#f87171" />
                      <Text style={styles.statText}>
                        {selectedVenue?.sceneScore}
                      </Text>
                    </View>
                    <View style={styles.statItem}>
                      <Icon name="people" size={20} color="#f87171" />
                      <Text style={styles.statText}>
                        {selectedVenue?.currentCheckins} here now
                      </Text>
                    </View>
                    <View style={styles.statItem}>
                      <Icon name="camera-alt" size={20} color="#f87171" />
                      <Text style={styles.statText}>
                        {selectedVenue?.totalPhotos} photos
                      </Text>
                    </View>
                  </View>

                  {selectedVenue?.activePromotions?.length > 0 && (
                    <View style={styles.promoCard}>
                      <Icon name="card-giftcard" size={20} color="#f87171" />
                      <Text style={styles.promoText}>
                        Active Promo: {selectedVenue.activePromotions[0].title}
                      </Text>
                    </View>
                  )}

                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      style={[
                        styles.checkInButton,
                        userCheckedIn === selectedVenue?.id &&
                          styles.checkedInButton,
                      ]}
                      onPress={() =>
                        userCheckedIn === selectedVenue?.id
                          ? handleCheckOut(userCheckedIn)
                          : handleCheckIn(
                              selectedVenue?.id,
                              selectedVenue?.coordinates.lat,
                              selectedVenue?.coordinates.lng
                            )
                      }
                    >
                      <Text style={styles.checkInText}>
                        {userCheckedIn === selectedVenue?.id
                          ? "Checked In"
                          : "Check In"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cameraButton}>
                      <Icon name="camera-alt" size={20} color="#f87171" />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>
          </>
        )}
      </View>
    );

    // Venue list component with real data
    const VenueList = () => (
      <ScrollView style={styles.venueList}>
        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>Venues Near You</Text>
          <View style={styles.searchContainer}>
            <Icon
              name="search"
              size={20}
              color="#f87171"
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Search venues..."
              placeholderTextColor="#9ca3af"
            />
          </View>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#f87171" />
        ) : (
          <View style={styles.venueCards}>
            {venues.map((venue) => (
              <View key={venue.id} style={styles.venueCard}>
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={styles.venueName}>{venue.name}</Text>
                    <Text style={styles.venueType}>
                      {venue.type} • {venue.location}
                    </Text>
                  </View>
                  <View style={styles.cardRight}>
                    <View style={styles.scoreContainer}>
                      <Icon name="star" size={16} color="#f87171" />
                      <Text style={styles.scoreValue}>{venue.sceneScore}</Text>
                    </View>
                    <Text style={styles.distance}>{venue.distance}</Text>
                  </View>
                </View>

                <View style={styles.cardStats}>
                  <View style={styles.cardStatsLeft}>
                    <View style={styles.statPair}>
                      <Icon name="people" size={16} color="#f87171" />
                      <Text style={styles.statSmall}>
                        {venue.currentCheckins}
                      </Text>
                    </View>
                    <View style={styles.statPair}>
                      <Icon name="camera-alt" size={16} color="#f87171" />
                      <Text style={styles.statSmall}>{venue.totalPhotos}</Text>
                    </View>
                  </View>
                  {venue.hasPromo && (
                    <View style={styles.promoIndicator}>
                      <Icon name="card-giftcard" size={16} color="#f87171" />
                      <Text style={styles.promoLabel}>Promo</Text>
                    </View>
                  )}
                </View>

                <TouchableOpacity
                  style={[
                    styles.venueCheckInButton,
                    userCheckedIn === venue.id && styles.venueCheckedInButton,
                  ]}
                  onPress={() =>
                    userCheckedIn === venue.id
                      ? handleCheckOut(userCheckedIn)
                      : handleCheckIn(
                          venue.id,
                          venue.coordinates.lat,
                          venue.coordinates.lng
                        )
                  }
                >
                  <Text style={styles.venueCheckInText}>
                    {userCheckedIn === venue.id ? "Checked In" : "Check In"}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    );

    // Photo feed with real data
    const PhotoFeed = () => (
      <ScrollView style={styles.photoFeed}>
        <View style={styles.photoHeader}>
          <Text style={styles.photoTitle}>Scene Photos</Text>
          <TouchableOpacity style={styles.addPhotoButton}>
            <Icon name="add" size={20} color="white" />
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#f87171" />
        ) : (
          <View style={styles.photoGrid}>
            {photos.map((photo) => (
              <TouchableOpacity key={photo.id} style={styles.photoCard}>
                <View style={styles.photoPlaceholder}>
                  <Icon name="camera-alt" size={32} color="#f87171" />
                </View>
                <View style={styles.photoOverlay}>
                  <View style={styles.photoInfo}>
                    <View style={styles.photoLocation}>
                      <Icon name="location-on" size={16} color="#f87171" />
                      <Text style={styles.photoLocationText}>
                        {photo.venue?.name || "Unknown venue"}
                      </Text>
                    </View>
                    <View style={styles.photoLikes}>
                      <Icon name="favorite" size={16} color="#f87171" />
                      <Text style={styles.photoLikesText}>{photo.likes}</Text>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    );

    // Profile with real data
    const Profile = () => (
      <ScrollView style={styles.profile}>
        {loading ? (
          <ActivityIndicator size="large" color="#f87171" />
        ) : (
          <>
            <View style={styles.profileHeader}>
              <View style={styles.profileAvatar}>
                <Icon name="person" size={40} color="white" />
              </View>
              <Text style={styles.profileName}>
                {userProfile?.name || "Your Profile"}
              </Text>
              <Text style={styles.profileRole}>
                {userProfile?.role === "venue_manager"
                  ? "Venue Manager"
                  : "Scene Explorer"}
              </Text>
            </View>

            <View style={styles.profileStats}>
              <View style={styles.profileStat}>
                <Text style={styles.profileStatLabel}>Total Check-ins</Text>
                <Text style={styles.profileStatValue}>
                  {userProfile?.profile?.totalCheckins || 0}
                </Text>
              </View>
              <View style={styles.profileStat}>
                <Text style={styles.profileStatLabel}>Photos Shared</Text>
                <Text style={styles.profileStatValue}>
                  {userProfile?.profile?.photosShared || 0}
                </Text>
              </View>
              <View style={styles.profileStat}>
                <Text style={styles.profileStatLabel}>Scene Score</Text>
                <Text style={styles.profileStatValue}>
                  {userProfile?.profile?.sceneScore || 0}
                </Text>
              </View>
            </View>

            <TouchableOpacity style={styles.editProfileButton}>
              <Text style={styles.editProfileText}>Edit Profile</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    );

    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />
        <View style={styles.appContent}>
          {activeTab === "map" && <SceneMap />}
          {activeTab === "venues" && <VenueList />}
          {activeTab === "photos" && <PhotoFeed />}
          {activeTab === "profile" && <Profile />}
        </View>

        <View style={styles.tabBar}>
          {[
            { id: "map", icon: "map", label: "Map" },
            { id: "venues", icon: "people", label: "Venues" },
            { id: "photos", icon: "camera-alt", label: "Photos" },
            { id: "profile", icon: "person", label: "Profile" },
          ].map((tab) => (
            <TouchableOpacity
              key={tab.id}
              style={[
                styles.tabButton,
                activeTab === tab.id && styles.activeTabButton,
              ]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Icon
                name={tab.icon}
                size={24}
                color={activeTab === tab.id ? "#f87171" : "#9ca3af"}
              />
              <Text
                style={[
                  styles.tabLabel,
                  activeTab === tab.id && styles.activeTabLabel,
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </SafeAreaView>
    );
  };

  // Venue Dashboard Component (similar modifications needed)
  const VenueDashboard = () => {
    const [activeTab, setActiveTab] = useState("analytics");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [venueData, setVenueData] = useState(null);
    const [analyticsData, setAnalyticsData] = useState(null);
    const [promotions, setPromotions] = useState([]);
    const [newPromoModal, setNewPromoModal] = useState(false);
    const [newPromoData, setNewPromoData] = useState({
      title: "",
      description: "",
      startTime: "",
      endTime: "",
      type: "discount",
      discountPercentage: 10,
      validDays: [],
    });

    // Fetch venue data from API
    const fetchVenueData = async () => {
      try {
        setLoading(true);
        const response = await axios.get(`${API_BASE_URL}/venues/manager`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setVenueData(response.data);
      } catch (err) {
        setError(err.response?.data?.error || "Failed to fetch venue data");
      } finally {
        setLoading(false);
      }
    };

    // Fetch analytics data
    const fetchAnalyticsData = async () => {
      try {
        setLoading(true);
        const response = await axios.get(
          `${API_BASE_URL}/venues/${venueData?.id}/analytics`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setAnalyticsData(response.data);
      } catch (err) {
        setError(err.response?.data?.error || "Failed to fetch analytics");
      } finally {
        setLoading(false);
      }
    };

    // Fetch promotions
    const fetchPromotions = async () => {
      try {
        setLoading(true);
        const response = await axios.get(
          `${API_BASE_URL}/venues/${venueData?.id}/promotions`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setPromotions(response.data);
      } catch (err) {
        setError(err.response?.data?.error || "Failed to fetch promotions");
      } finally {
        setLoading(false);
      }
    };

    // Create new promotion
    const createPromotion = async () => {
      try {
        setLoading(true);
        await axios.post(
          `${API_BASE_URL}/promotions`,
          { ...newPromoData, venueId: venueData?.id },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setNewPromoModal(false);
        fetchPromotions();
      } catch (err) {
        setError(err.response?.data?.error || "Failed to create promotion");
      } finally {
        setLoading(false);
      }
    };

    // Toggle promotion status
    const togglePromotion = async (promoId, currentStatus) => {
      try {
        setLoading(true);
        await axios.put(
          `${API_BASE_URL}/promotions/${promoId}`,
          { active: !currentStatus },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        fetchPromotions();
      } catch (err) {
        setError(err.response?.data?.error || "Failed to update promotion");
      } finally {
        setLoading(false);
      }
    };

    // Load data on component mount
    useEffect(() => {
      if (token) {
        fetchVenueData();
      }
    }, [token]);

    useEffect(() => {
      if (venueData) {
        fetchAnalyticsData();
        fetchPromotions();
      }
    }, [venueData]);

    // Analytics Tab
    const AnalyticsTab = () => (
      <ScrollView style={styles.dashboardContent}>
        <Text style={styles.dashboardTitle}>Venue Analytics</Text>

        {loading ? (
          <ActivityIndicator size="large" color="#f87171" />
        ) : (
          <>
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>
                  {venueData?.currentCheckins || 0}
                </Text>
                <Text style={styles.statLabel}>Current Check-ins</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>
                  {venueData?.totalCheckins || 0}
                </Text>
                <Text style={styles.statLabel}>Total Check-ins</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>
                  {venueData?.sceneScore || 0}
                </Text>
                <Text style={styles.statLabel}>Scene Score</Text>
              </View>
            </View>

            <Text style={styles.chartTitle}>Weekly Check-ins</Text>
            <LineChart
              data={{
                labels:
                  analyticsData?.weeklyCheckins.map((item) =>
                    item.day.substring(0, 3)
                  ) || [],
                datasets: [
                  {
                    data:
                      analyticsData?.weeklyCheckins.map(
                        (item) => item.checkins
                      ) || [],
                  },
                ],
              }}
              width={screenWidth - 40}
              height={220}
              chartConfig={{
                backgroundColor: "#1e1e1e",
                backgroundGradientFrom: "#1e1e1e",
                backgroundGradientTo: "#1e1e1e",
                decimalPlaces: 0,
                color: (opacity = 1) => `rgba(248, 113, 113, ${opacity})`,
                labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
                style: { borderRadius: 16 },
              }}
              bezier
              style={styles.chart}
            />

            <Text style={styles.chartTitle}>Hourly Traffic</Text>
            <BarChart
              data={{
                labels:
                  analyticsData?.hourlyTraffic.map((item) => item.hour) || [],
                datasets: [
                  {
                    data:
                      analyticsData?.hourlyTraffic.map((item) => item.users) ||
                      [],
                  },
                ],
              }}
              width={screenWidth - 40}
              height={220}
              chartConfig={{
                backgroundColor: "#1e1e1e",
                backgroundGradientFrom: "#1e1e1e",
                backgroundGradientTo: "#1e1e1e",
                decimalPlaces: 0,
                color: (opacity = 1) => `rgba(248, 113, 113, ${opacity})`,
                labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
              }}
              style={styles.chart}
            />
          </>
        )}
      </ScrollView>
    );

    // Promotions Tab
    const PromotionsTab = () => (
      <ScrollView style={styles.dashboardContent}>
        <View style={styles.promoHeader}>
          <Text style={styles.dashboardTitle}>Promotions</Text>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setNewPromoModal(true)}
          >
            <Icon name="add" size={20} color="white" />
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#f87171" />
        ) : (
          <>
            {promotions.map((promo) => (
              <View key={promo.id} style={styles.promoCard}>
                <View style={styles.promoCardHeader}>
                  <Text style={styles.promoTitle}>{promo.title}</Text>
                  <TouchableOpacity
                    style={[
                      styles.toggleButton,
                      promo.active && styles.toggleButtonActive,
                    ]}
                    onPress={() => togglePromotion(promo.id, promo.active)}
                  >
                    <Text style={styles.toggleButtonText}>
                      {promo.active ? "Active" : "Inactive"}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.promoDescription}>{promo.description}</Text>
                <View style={styles.promoDetails}>
                  <Text style={styles.promoDetail}>
                    {promo.startTime} - {promo.endTime}
                  </Text>
                  <Text style={styles.promoDetail}>
                    {promo.type === "discount"
                      ? `${promo.discountPercentage}% off`
                      : "Free offer"}
                  </Text>
                  <Text style={styles.promoDetail}>
                    {promo.validDays.join(", ")}
                  </Text>
                </View>
                <Text style={styles.promoRedemptions}>
                  {promo.redemptions} redemptions
                </Text>
              </View>
            ))}
          </>
        )}

        {/* New Promotion Modal */}
        <Modal visible={newPromoModal} transparent={true} animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.promoModal}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Create New Promotion</Text>
                <TouchableOpacity onPress={() => setNewPromoModal(false)}>
                  <Icon name="close" size={24} color="#f87171" />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalContent}>
                <TextInput
                  style={styles.input}
                  placeholder="Title"
                  value={newPromoData.title}
                  onChangeText={(text) =>
                    setNewPromoData({ ...newPromoData, title: text })
                  }
                />
                <TextInput
                  style={styles.input}
                  placeholder="Description"
                  value={newPromoData.description}
                  onChangeText={(text) =>
                    setNewPromoData({ ...newPromoData, description: text })
                  }
                />

                <View style={styles.timeInputs}>
                  <TextInput
                    style={[styles.input, styles.timeInput]}
                    placeholder="Start Time (HH:MM)"
                    value={newPromoData.startTime}
                    onChangeText={(text) =>
                      setNewPromoData({ ...newPromoData, startTime: text })
                    }
                  />
                  <TextInput
                    style={[styles.input, styles.timeInput]}
                    placeholder="End Time (HH:MM)"
                    value={newPromoData.endTime}
                    onChangeText={(text) =>
                      setNewPromoData({ ...newPromoData, endTime: text })
                    }
                  />
                </View>

                <View style={styles.promoTypeContainer}>
                  <Text style={styles.label}>Promotion Type:</Text>
                  <View style={styles.radioGroup}>
                    <TouchableOpacity
                      style={styles.radioButton}
                      onPress={() =>
                        setNewPromoData({ ...newPromoData, type: "discount" })
                      }
                    >
                      <View style={styles.radioCircle}>
                        {newPromoData.type === "discount" && (
                          <View style={styles.radioDot} />
                        )}
                      </View>
                      <Text style={styles.radioLabel}>Discount</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.radioButton}
                      onPress={() =>
                        setNewPromoData({ ...newPromoData, type: "free" })
                      }
                    >
                      <View style={styles.radioCircle}>
                        {newPromoData.type === "free" && (
                          <View style={styles.radioDot} />
                        )}
                      </View>
                      <Text style={styles.radioLabel}>Free Offer</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {newPromoData.type === "discount" && (
                  <View style={styles.discountInput}>
                    <Text style={styles.label}>Discount Percentage:</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="10"
                      keyboardType="numeric"
                      value={String(newPromoData.discountPercentage)}
                      onChangeText={(text) =>
                        setNewPromoData({
                          ...newPromoData,
                          discountPercentage: parseInt(text) || 0,
                        })
                      }
                    />
                  </View>
                )}

                <View style={styles.daysContainer}>
                  <Text style={styles.label}>Valid Days:</Text>
                  <View style={styles.daysGrid}>
                    {[
                      "Monday",
                      "Tuesday",
                      "Wednesday",
                      "Thursday",
                      "Friday",
                      "Saturday",
                      "Sunday",
                    ].map((day) => (
                      <TouchableOpacity
                        key={day}
                        style={[
                          styles.dayButton,
                          newPromoData.validDays.includes(day.toLowerCase()) &&
                            styles.dayButtonSelected,
                        ]}
                        onPress={() => {
                          const dayLower = day.toLowerCase();
                          if (newPromoData.validDays.includes(dayLower)) {
                            setNewPromoData({
                              ...newPromoData,
                              validDays: newPromoData.validDays.filter(
                                (d) => d !== dayLower
                              ),
                            });
                          } else {
                            setNewPromoData({
                              ...newPromoData,
                              validDays: [...newPromoData.validDays, dayLower],
                            });
                          }
                        }}
                      >
                        <Text style={styles.dayButtonText}>
                          {day.substring(0, 3)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </ScrollView>

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => setNewPromoModal(false)}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.createButton}
                  onPress={createPromotion}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text style={styles.createButtonText}>
                      Create Promotion
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    );

    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />

        <View style={styles.dashboardHeader}>
          <Text style={styles.venueName}>
            {venueData?.name || "Your Venue"}
          </Text>
          <Text style={styles.venueLocation}>{venueData?.location || ""}</Text>
        </View>

        <View style={styles.dashboardTabs}>
          <TouchableOpacity
            style={[
              styles.dashboardTab,
              activeTab === "analytics" && styles.activeDashboardTab,
            ]}
            onPress={() => setActiveTab("analytics")}
          >
            <Text
              style={[
                styles.dashboardTabText,
                activeTab === "analytics" && styles.activeDashboardTabText,
              ]}
            >
              Analytics
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.dashboardTab,
              activeTab === "promotions" && styles.activeDashboardTab,
            ]}
            onPress={() => setActiveTab("promotions")}
          >
            <Text
              style={[
                styles.dashboardTabText,
                activeTab === "promotions" && styles.activeDashboardTabText,
              ]}
            >
              Promotions
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === "analytics" ? <AnalyticsTab /> : <PromotionsTab />}
      </SafeAreaView>
    );
  };

  // Main App Controller
  return (
    <View style={styles.mainContainer}>
      {/* View Mode Toggle */}
      <View style={styles.viewToggle}>
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              viewMode === "customer" && styles.activeToggle,
            ]}
            onPress={() => setViewMode("customer")}
          >
            <Text
              style={[
                styles.toggleText,
                viewMode === "customer" && styles.activeToggleText,
              ]}
            >
              Customer App
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              viewMode === "venue" && styles.activeToggle,
            ]}
            onPress={() => setViewMode("venue")}
          >
            <Text
              style={[
                styles.toggleText,
                viewMode === "venue" && styles.activeToggleText,
              ]}
            >
              Venue Dashboard
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Render Selected View */}
      {viewMode === "customer" ? <SceneApp /> : <VenueDashboard />}
    </View>
  );
};

// ... keep all your existing styles ...

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    backgroundColor: "#000000",
  },
  viewToggle: {
    position: "absolute",
    top: 50,
    right: 16,
    zIndex: 1000,
  },
  toggleContainer: {
    flexDirection: "row",
    backgroundColor: "#1f2937",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#7f1d1d",
    padding: 4,
  },
  toggleButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  activeToggle: {
    backgroundColor: "#dc2626",
  },
  toggleText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#9ca3af",
  },
  activeToggleText: {
    color: "white",
  },
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  appContent: {
    flex: 1,
  },

  // Map Styles
  mapContainer: {
    flex: 1,
    backgroundColor: "#111827",
  },
  mapBackground: {
    flex: 1,
    position: "relative",
  },
  mapPin: {
    position: "absolute",
  },
  pinCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#dc2626",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  pinBadge: {
    position: "absolute",
    top: -8,
    right: -8,
    backgroundColor: "#000000",
    borderWidth: 1,
    borderColor: "#dc2626",
    borderRadius: 16,
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  pinBadgeText: {
    color: "#f87171",
    fontSize: 12,
    fontWeight: "bold",
  },
  scoreDisplay: {
    position: "absolute",
    top: 56,
    left: "50%",
    transform: [{ translateX: -20 }],
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    borderWidth: 1,
    borderColor: "rgba(220, 38, 38, 0.3)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  scoreText: {
    color: "#f87171",
    fontSize: 12,
    fontWeight: "bold",
  },
  mapHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(127, 29, 29, 0.3)",
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "white",
    marginLeft: 12,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  venueModal: {
    backgroundColor: "#000000",
    borderTopWidth: 1,
    borderTopColor: "rgba(127, 29, 29, 0.3)",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: 320,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  venueTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "white",
  },
  venueSubtitle: {
    color: "#f87171",
    marginTop: 4,
  },
  venueStats: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 16,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statText: {
    color: "white",
    fontSize: 14,
  },
  promoCard: {
    backgroundColor: "rgba(127, 29, 29, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(220, 38, 38, 0.3)",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  promoText: {
    color: "#f87171",
    fontWeight: "600",
    flex: 1,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
  checkInButton: {
    flex: 1,
    backgroundColor: "#dc2626",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  checkedInButton: {
    backgroundColor: "#b91c1c",
  },
  checkInText: {
    color: "white",
    fontWeight: "600",
  },
  cameraButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#1f2937",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },

  // Venue List Styles
  venueList: {
    flex: 1,
    backgroundColor: "#000000",
  },
  listHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(127, 29, 29, 0.3)",
  },
  listTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "white",
    marginBottom: 12,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1f2937",
    borderWidth: 1,
    borderColor: "rgba(127, 29, 29, 0.3)",
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 8,
    color: "white",
    fontSize: 16,
  },
  venueCards: {
    padding: 16,
    gap: 16,
  },
  venueCard: {
    backgroundColor: "#1f2937",
    borderWidth: 1,
    borderColor: "rgba(127, 29, 29, 0.3)",
    borderRadius: 8,
    padding: 16,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  venueName: {
    color: "white",
    fontWeight: "600",
    fontSize: 16,
  },
  venueType: {
    color: "#9ca3af",
    fontSize: 14,
    marginTop: 2,
  },
  cardRight: {
    alignItems: "flex-end",
  },
  scoreContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  scoreValue: {
    color: "white",
    fontWeight: "bold",
  },
  distance: {
    color: "#9ca3af",
    fontSize: 14,
    marginTop: 2,
  },
  cardStats: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  cardStatsLeft: {
    flexDirection: "row",
    gap: 16,
  },
  statPair: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statSmall: {
    color: "white",
    fontSize: 14,
  },
  promoIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  promoLabel: {
    color: "#f87171",
    fontSize: 14,
    fontWeight: "600",
  },
  venueCheckInButton: {
    backgroundColor: "#dc2626",
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  venueCheckedInButton: {
    backgroundColor: "#b91c1c",
  },
  venueCheckInText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },

  // Photo Feed Styles
  photoFeed: {
    flex: 1,
    backgroundColor: "#000000",
  },
  photoHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(127, 29, 29, 0.3)",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  photoTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "white",
  },
  addPhotoButton: {
    backgroundColor: "#dc2626",
    padding: 8,
    borderRadius: 8,
  },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  photoCard: {
    width: screenWidth / 2,
    aspectRatio: 1,
    position: "relative",
  },
  photoPlaceholder: {
    flex: 1,
    backgroundColor: "#1f2937",
    justifyContent: "center",
    alignItems: "center",
    margin: 1,
  },
  photoOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    padding: 8,
    margin: 1,
  },
  photoInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  photoLocation: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flex: 1,
  },
  photoLocationText: {
    color: "white",
    fontSize: 12,
  },
  photoLikes: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  photoLikesText: {
    color: "white",
    fontSize: 12,
  },

  // Profile Styles
  profile: {
    flex: 1,
    backgroundColor: "#000000",
    padding: 16,
  },
  profileHeader: {
    alignItems: "center",
    marginBottom: 24,
  },
  profileAvatar: {
    width: 80,
    height: 80,
    backgroundColor: "#dc2626",
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  profileName: {
    fontSize: 20,
    fontWeight: "bold",
    color: "white",
  },
  profileRole: {
    color: "#9ca3af",
    marginTop: 4,
  },
  profileStats: {
    gap: 16,
  },
  profileStat: {
    backgroundColor: "#1f2937",
    borderWidth: 1,
    borderColor: "rgba(127, 29, 29, 0.3)",
    borderRadius: 8,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  profileStatLabel: {
    color: "white",
  },
  profileStatValue: {
    color: "#f87171",
    fontWeight: "bold",
  },
  editProfileButton: {
    backgroundColor: "#dc2626",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 24,
  },
  editProfileText: {
    color: "white",
    fontWeight: "600",
  },

  // Tab Bar Styles
  tabBar: {
    backgroundColor: "#000000",
    borderTopWidth: 1,
    borderTopColor: "rgba(127, 29, 29, 0.3)",
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  activeTabButton: {
    backgroundColor: "rgba(127, 29, 29, 0.2)",
  },
  tabLabel: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 4,
  },
  activeTabLabel: {
    color: "#f87171",
  },

  // Dashboard Styles
  dashboardContainer: {
    flex: 1,
    backgroundColor: "#000000",
  },
  dashboardHeader: {
    backgroundColor: "#000000",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(127, 29, 29, 0.3)",
    paddingHorizontal: 24,
    paddingVertical: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dashboardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  dashboardIcon: {
    width: 40,
    height: 40,
    backgroundColor: "#dc2626",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  dashboardTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "white",
  },
  dashboardSubtitle: {
    color: "#f87171",
  },
  dashboardHeaderRight: {
    flexDirection: "row",
    gap: 16,
  },
  headerButton: {
    padding: 8,
    borderRadius: 8,
  },
  dashboardTabs: {
    backgroundColor: "#1f2937",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(127, 29, 29, 0.3)",
    paddingVertical: 8,
  },
  dashboardTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 4,
    borderRadius: 8,
  },
  activeDashboardTab: {
    backgroundColor: "#dc2626",
  },
  dashboardTabText: {
    color: "#9ca3af",
    fontWeight: "600",
  },
  activeDashboardTabText: {
    color: "white",
  },
  dashboardMain: {
    flex: 1,
  },
  dashboardContent: {
    flex: 1,
    padding: 16,
  },

  // Stats Card Styles
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginBottom: 24,
  },
  statsCard: {
    backgroundColor: "#1f2937",
    borderWidth: 1,
    borderColor: "rgba(127, 29, 29, 0.3)",
    borderRadius: 8,
    padding: 16,
    width: (screenWidth - 48) / 2,
  },
  statsContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  statsTitle: {
    color: "#9ca3af",
    fontSize: 14,
  },
  statsValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "white",
    marginTop: 4,
  },
  statsChange: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  statsChangeText: {
    color: "#10b981",
    fontSize: 12,
  },
  statsIcon: {
    width: 48,
    height: 48,
    backgroundColor: "rgba(220, 38, 38, 0.2)",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },

  // Chart Styles
  chartContainer: {
    backgroundColor: "#1f2937",
    borderWidth: 1,
    borderColor: "rgba(127, 29, 29, 0.3)",
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
  },
  chartTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "white",
    marginBottom: 16,
  },
  chart: {
    borderRadius: 16,
  },

  // Active Promos Styles
  activePromos: {
    backgroundColor: "#1f2937",
    borderWidth: 1,
    borderColor: "rgba(127, 29, 29, 0.3)",
    borderRadius: 8,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "white",
    marginBottom: 16,
  },
  promoItem: {
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(127, 29, 29, 0.3)",
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  promoContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  promoDetails: {
    flex: 1,
  },
  promoTitle: {
    color: "white",
    fontWeight: "600",
  },
  promoDescription: {
    color: "#9ca3af",
    fontSize: 14,
    marginTop: 2,
  },
  promoStats: {
    alignItems: "flex-end",
  },
  promoUsed: {
    color: "#f87171",
    fontWeight: "bold",
  },
  promoTime: {
    color: "#9ca3af",
    fontSize: 12,
    marginTop: 2,
  },

  // Promotions Section Styles
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  createButton: {
    backgroundColor: "#dc2626",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  createButtonText: {
    color: "white",
    fontWeight: "600",
  },
  promosGrid: {
    gap: 16,
  },
  promoCard: {
    backgroundColor: "#1f2937",
    borderWidth: 1,
    borderColor: "rgba(127, 29, 29, 0.3)",
    borderRadius: 8,
    padding: 16,
  },
  promoCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  promoCardTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  promoCardName: {
    color: "white",
    fontWeight: "600",
    fontSize: 16,
  },
  promoCardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  activeBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.3)",
  },
  inactiveBadge: {
    backgroundColor: "#1f2937",
  },
  statusText: {
    fontSize: 12,
  },
  activeText: {
    color: "#10b981",
  },
  inactiveText: {
    color: "#9ca3af",
  },
  promoCardDescription: {
    color: "#9ca3af",
    fontSize: 14,
    marginBottom: 16,
  },
  promoCardDetails: {
    gap: 8,
    marginBottom: 16,
  },
  promoCardDetail: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  detailLabel: {
    color: "#9ca3af",
    fontSize: 14,
  },
  detailValue: {
    color: "white",
    fontSize: 14,
  },
  detailValueRed: {
    color: "#f87171",
    fontWeight: "bold",
    fontSize: 14,
  },
  promoToggleButton: {
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  deactivateButton: {
    backgroundColor: "#b91c1c",
  },
  activateButton: {
    backgroundColor: "#1f2937",
  },
  promoToggleText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },

  // Promo Modal Styles
  promoModalContent: {
    backgroundColor: "#1f2937",
    borderWidth: 1,
    borderColor: "rgba(127, 29, 29, 0.3)",
    borderRadius: 8,
    margin: 16,
    maxHeight: screenHeight * 0.8,
  },
  promoModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(127, 29, 29, 0.3)",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "white",
  },
  promoForm: {
    padding: 24,
  },
  formGroup: {
    marginBottom: 16,
  },
  formLabel: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 8,
  },
  formInput: {
    backgroundColor: "#000000",
    borderWidth: 1,
    borderColor: "rgba(127, 29, 29, 0.3)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: "white",
    fontSize: 16,
  },
  textArea: {
    height: 80,
    textAlignVertical: "top",
  },
  formRow: {
    flexDirection: "row",
    gap: 16,
  },
  formHalf: {
    flex: 1,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: "rgba(127, 29, 29, 0.3)",
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#6b7280",
    borderRadius: 8,
    alignItems: "center",
  },
  cancelButtonText: {
    color: "#9ca3af",
    fontWeight: "600",
  },
  createPromoButton: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: "#dc2626",
    borderRadius: 8,
    alignItems: "center",
  },
  createPromoButtonText: {
    color: "white",
    fontWeight: "600",
  },
  // Auth styles
  authContainer: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: "#1e1e1e",
  },
  authTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#f87171",
    marginBottom: 20,
    textAlign: "center",
  },
  authInput: {
    backgroundColor: "#2d2d2d",
    color: "white",
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
  },
  authButton: {
    backgroundColor: "#f87171",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },
  authButtonText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
  authToggle: {
    marginTop: 20,
    alignItems: "center",
  },
  authToggleText: {
    color: "#9ca3af",
  },
  authError: {
    color: "#ef4444",
    marginBottom: 15,
    textAlign: "center",
  },

  // Dashboard styles
  dashboardHeader: {
    padding: 20,
    backgroundColor: "#1e1e1e",
  },
  venueName: {
    fontSize: 24,
    fontWeight: "bold",
    color: "white",
  },
  venueLocation: {
    fontSize: 16,
    color: "#9ca3af",
    marginTop: 5,
  },
  dashboardTabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d2d",
  },
  dashboardTab: {
    flex: 1,
    padding: 15,
    alignItems: "center",
  },
  activeDashboardTab: {
    borderBottomWidth: 2,
    borderBottomColor: "#f87171",
  },
  dashboardTabText: {
    color: "#9ca3af",
    fontWeight: "bold",
  },
  activeDashboardTabText: {
    color: "#f87171",
  },
  dashboardContent: {
    flex: 1,
    padding: 20,
    backgroundColor: "#1e1e1e",
  },
  dashboardTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "white",
    marginBottom: 20,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  statCard: {
    backgroundColor: "#2d2d2d",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    flex: 1,
    marginHorizontal: 5,
  },
  statValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#f87171",
  },
  statLabel: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 5,
  },
  chartTitle: {
    color: "white",
    marginTop: 20,
    marginBottom: 10,
  },
  chart: {
    marginVertical: 8,
    borderRadius: 16,
  },
  promoHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  addButton: {
    backgroundColor: "#f87171",
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  promoCard: {
    backgroundColor: "#2d2d2d",
    borderRadius: 8,
    padding: 15,
    marginBottom: 15,
  },
  promoCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  promoTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "white",
  },
  toggleButton: {
    backgroundColor: "#3f3f3f",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 15,
  },
  toggleButtonActive: {
    backgroundColor: "#f87171",
  },
  toggleButtonText: {
    color: "white",
    fontSize: 12,
  },
  promoDescription: {
    color: "#d1d5db",
    marginBottom: 10,
  },
  promoDetails: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 10,
  },
  promoDetail: {
    color: "#9ca3af",
    marginRight: 15,
    fontSize: 12,
  },
  promoRedemptions: {
    color: "#f87171",
    fontSize: 12,
  },
  promoModal: {
    backgroundColor: "#2d2d2d",
    borderRadius: 10,
    padding: 20,
    maxHeight: "80%",
    width: "90%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "white",
  },
  modalContent: {
    maxHeight: "70%",
  },
  modalFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 20,
  },
  cancelButton: {
    backgroundColor: "#3f3f3f",
    padding: 15,
    borderRadius: 8,
    flex: 1,
    marginRight: 10,
    alignItems: "center",
  },
  cancelButtonText: {
    color: "white",
    fontWeight: "bold",
  },
  createButton: {
    backgroundColor: "#f87171",
    padding: 15,
    borderRadius: 8,
    flex: 1,
    alignItems: "center",
  },
  createButtonText: {
    color: "white",
    fontWeight: "bold",
  },
  timeInputs: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  timeInput: {
    width: "48%",
  },
  label: {
    color: "white",
    marginBottom: 10,
  },
  promoTypeContainer: {
    marginVertical: 15,
  },
  radioGroup: {
    flexDirection: "row",
    marginTop: 10,
  },
  radioButton: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 20,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#f87171",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#f87171",
  },
  radioLabel: {
    color: "white",
  },
  daysContainer: {
    marginVertical: 15,
  },
  daysGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  dayButton: {
    width: "14%",
    aspectRatio: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#3f3f3f",
    borderRadius: 5,
    marginVertical: 5,
  },
  dayButtonSelected: {
    backgroundColor: "#f87171",
  },
  dayButtonText: {
    color: "white",
    fontSize: 12,
  },
});

export default SceneAppComplete;
