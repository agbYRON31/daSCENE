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
} from "react-native";
import Icon from "react-native-vector-icons/MaterialIcons";
import { LineChart, BarChart } from "react-native-chart-kit";

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

const SceneAppComplete = () => {
  const [viewMode, setViewMode] = useState("customer"); // 'customer' or 'venue'

  // Customer App Component
  const SceneApp = () => {
    const [activeTab, setActiveTab] = useState("map");
    const [venues, setVenues] = useState([
      {
        id: 1,
        name: "Midnight Lounge",
        location: "Downtown",
        checkedIn: 47,
        sceneScore: 9.2,
        photos: 12,
        hasPromo: true,
        distance: "0.2 mi",
        type: "Nightclub",
      },
      {
        id: 2,
        name: "Red Room Bar",
        location: "Arts District",
        checkedIn: 23,
        sceneScore: 7.8,
        photos: 8,
        hasPromo: false,
        distance: "0.5 mi",
        type: "Bar",
      },
      {
        id: 3,
        name: "Club Pulse",
        location: "Uptown",
        checkedIn: 89,
        sceneScore: 9.7,
        photos: 24,
        hasPromo: true,
        distance: "1.2 mi",
        type: "Nightclub",
      },
    ]);

    const [userCheckedIn, setUserCheckedIn] = useState(null);
    const [selectedVenue, setSelectedVenue] = useState(null);

    const handleCheckIn = (venueId) => {
      if (userCheckedIn === venueId) {
        setUserCheckedIn(null);
      } else {
        setUserCheckedIn(venueId);
        setVenues((prev) =>
          prev.map((v) =>
            v.id === venueId
              ? { ...v, checkedIn: v.checkedIn + (userCheckedIn ? 0 : 1) }
              : v
          )
        );
      }
    };

    const SceneMap = () => (
      <View style={styles.mapContainer}>
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
                <Text style={styles.pinBadgeText}>{venue.checkedIn}</Text>
              </View>
              <View style={styles.scoreDisplay}>
                <Text style={styles.scoreText}>{venue.sceneScore}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.mapHeader}>
          <View style={styles.headerLeft}>
            <Icon name="menu" size={24} color="#f87171" />
            <Text style={styles.headerTitle}>Scene</Text>
          </View>
          <View style={styles.headerRight}>
            <Icon name="search" size={24} color="#f87171" />
            <Icon name="notifications" size={24} color="#f87171" />
            <Icon name="person" size={24} color="#f87171" />
          </View>
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
                  <Text style={styles.venueTitle}>{selectedVenue?.name}</Text>
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
                    {selectedVenue?.checkedIn} here now
                  </Text>
                </View>
                <View style={styles.statItem}>
                  <Icon name="camera-alt" size={20} color="#f87171" />
                  <Text style={styles.statText}>
                    {selectedVenue?.photos} photos
                  </Text>
                </View>
              </View>

              {selectedVenue?.hasPromo && (
                <View style={styles.promoCard}>
                  <Icon name="card-giftcard" size={20} color="#f87171" />
                  <Text style={styles.promoText}>
                    Active Promo: 25% off drinks until 11 PM
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
                  onPress={() => handleCheckIn(selectedVenue?.id)}
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
      </View>
    );

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
                    <Text style={styles.statSmall}>{venue.checkedIn}</Text>
                  </View>
                  <View style={styles.statPair}>
                    <Icon name="camera-alt" size={16} color="#f87171" />
                    <Text style={styles.statSmall}>{venue.photos}</Text>
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
                onPress={() => handleCheckIn(venue.id)}
              >
                <Text style={styles.venueCheckInText}>
                  {userCheckedIn === venue.id ? "Checked In" : "Check In"}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </ScrollView>
    );

    const PhotoFeed = () => (
      <ScrollView style={styles.photoFeed}>
        <View style={styles.photoHeader}>
          <Text style={styles.photoTitle}>Scene Photos</Text>
          <TouchableOpacity style={styles.addPhotoButton}>
            <Icon name="add" size={20} color="white" />
          </TouchableOpacity>
        </View>

        <View style={styles.photoGrid}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <TouchableOpacity key={i} style={styles.photoCard}>
              <View style={styles.photoPlaceholder}>
                <Icon name="camera-alt" size={32} color="#f87171" />
              </View>
              <View style={styles.photoOverlay}>
                <View style={styles.photoInfo}>
                  <View style={styles.photoLocation}>
                    <Icon name="location-on" size={16} color="#f87171" />
                    <Text style={styles.photoLocationText}>
                      Midnight Lounge
                    </Text>
                  </View>
                  <View style={styles.photoLikes}>
                    <Icon name="favorite" size={16} color="#f87171" />
                    <Text style={styles.photoLikesText}>
                      {Math.floor(Math.random() * 50) + 10}
                    </Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    );

    const Profile = () => (
      <ScrollView style={styles.profile}>
        <View style={styles.profileHeader}>
          <View style={styles.profileAvatar}>
            <Icon name="person" size={40} color="white" />
          </View>
          <Text style={styles.profileName}>Your Profile</Text>
          <Text style={styles.profileRole}>Scene Explorer</Text>
        </View>

        <View style={styles.profileStats}>
          <View style={styles.profileStat}>
            <Text style={styles.profileStatLabel}>Total Check-ins</Text>
            <Text style={styles.profileStatValue}>47</Text>
          </View>
          <View style={styles.profileStat}>
            <Text style={styles.profileStatLabel}>Photos Shared</Text>
            <Text style={styles.profileStatValue}>23</Text>
          </View>
          <View style={styles.profileStat}>
            <Text style={styles.profileStatLabel}>Scene Score</Text>
            <Text style={styles.profileStatValue}>8.9</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.editProfileButton}>
          <Text style={styles.editProfileText}>Edit Profile</Text>
        </TouchableOpacity>
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

  // Venue Dashboard Component
  const VenueDashboard = () => {
    const [activeTab, setActiveTab] = useState("overview");
    const [showPromoModal, setShowPromoModal] = useState(false);

    const [venue] = useState({
      name: "Midnight Lounge",
      address: "123 Downtown Blvd, City Center",
      type: "Nightclub",
      sceneScore: 9.2,
      totalCheckins: 1247,
      currentCheckins: 47,
      totalPhotos: 89,
      verified: true,
    });

    const [analytics] = useState({
      weeklyCheckins: [23, 18, 31, 45, 89, 156, 67],
      hourlyData: [12, 28, 45, 67, 89, 112, 134, 98, 45],
    });

    const [promos, setPromos] = useState([
      {
        id: 1,
        title: "Happy Hour Special",
        description: "25% off all drinks",
        startTime: "18:00",
        endTime: "20:00",
        active: true,
        redemptions: 23,
        type: "discount",
      },
      {
        id: 2,
        title: "Ladies Night",
        description: "Free cocktails for ladies",
        startTime: "21:00",
        endTime: "23:00",
        active: false,
        redemptions: 0,
        type: "free",
      },
    ]);

    const [newPromo, setNewPromo] = useState({
      title: "",
      description: "",
      startTime: "",
      endTime: "",
      type: "discount",
    });

    const StatsCard = ({ title, value, change, iconName }) => (
      <View style={styles.statsCard}>
        <View style={styles.statsContent}>
          <View>
            <Text style={styles.statsTitle}>{title}</Text>
            <Text style={styles.statsValue}>{value}</Text>
            {change && (
              <View style={styles.statsChange}>
                <Icon name="trending-up" size={16} color="#10b981" />
                <Text style={styles.statsChangeText}>+{change}%</Text>
              </View>
            )}
          </View>
          <View style={styles.statsIcon}>
            <Icon name={iconName} size={24} color="#f87171" />
          </View>
        </View>
      </View>
    );

    const Overview = () => (
      <ScrollView style={styles.dashboardContent}>
        <View style={styles.statsGrid}>
          <StatsCard
            title="Scene Score"
            value={venue.sceneScore}
            change={12}
            iconName="star"
          />
          <StatsCard
            title="Currently Here"
            value={venue.currentCheckins}
            change={8}
            iconName="people"
          />
          <StatsCard
            title="Total Check-ins"
            value={venue.totalCheckins.toLocaleString()}
            change={23}
            iconName="location-on"
          />
          <StatsCard
            title="Photos Shared"
            value={venue.totalPhotos}
            change={15}
            iconName="camera-alt"
          />
        </View>

        <View style={styles.chartContainer}>
          <Text style={styles.chartTitle}>Weekly Check-ins</Text>
          <BarChart
            data={{
              labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
              datasets: [{ data: analytics.weeklyCheckins }],
            }}
            width={screenWidth - 32}
            height={220}
            chartConfig={{
              backgroundColor: "#1f2937",
              backgroundGradientFrom: "#1f2937",
              backgroundGradientTo: "#111827",
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(220, 38, 38, ${opacity})`,
              style: { borderRadius: 16 },
            }}
            style={styles.chart}
          />
        </View>

        <View style={styles.chartContainer}>
          <Text style={styles.chartTitle}>Today's Traffic</Text>
          <LineChart
            data={{
              labels: ["6PM", "8PM", "10PM", "12AM", "2AM"],
              datasets: [{ data: [12, 45, 89, 134, 45] }],
            }}
            width={screenWidth - 32}
            height={220}
            chartConfig={{
              backgroundColor: "#1f2937",
              backgroundGradientFrom: "#1f2937",
              backgroundGradientTo: "#111827",
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(220, 38, 38, ${opacity})`,
              style: { borderRadius: 16 },
            }}
            style={styles.chart}
          />
        </View>

        <View style={styles.activePromos}>
          <Text style={styles.sectionTitle}>Active Promotions</Text>
          {promos
            .filter((p) => p.active)
            .map((promo) => (
              <View key={promo.id} style={styles.promoItem}>
                <View style={styles.promoContent}>
                  <Icon name="card-giftcard" size={20} color="#f87171" />
                  <View style={styles.promoDetails}>
                    <Text style={styles.promoTitle}>{promo.title}</Text>
                    <Text style={styles.promoDescription}>
                      {promo.description}
                    </Text>
                  </View>
                </View>
                <View style={styles.promoStats}>
                  <Text style={styles.promoUsed}>{promo.redemptions} used</Text>
                  <Text style={styles.promoTime}>
                    {promo.startTime} - {promo.endTime}
                  </Text>
                </View>
              </View>
            ))}
        </View>
      </ScrollView>
    );

    const Promotions = () => (
      <ScrollView style={styles.dashboardContent}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Promotions</Text>
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => setShowPromoModal(true)}
          >
            <Icon name="add" size={16} color="white" />
            <Text style={styles.createButtonText}>Create Promo</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.promosGrid}>
          {promos.map((promo) => (
            <View key={promo.id} style={styles.promoCard}>
              <View style={styles.promoCardHeader}>
                <View style={styles.promoCardTitle}>
                  <Icon name="card-giftcard" size={20} color="#f87171" />
                  <Text style={styles.promoCardName}>{promo.title}</Text>
                </View>
                <View style={styles.promoCardActions}>
                  <View
                    style={[
                      styles.statusBadge,
                      promo.active ? styles.activeBadge : styles.inactiveBadge,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        promo.active ? styles.activeText : styles.inactiveText,
                      ]}
                    >
                      {promo.active ? "Active" : "Inactive"}
                    </Text>
                  </View>
                  <TouchableOpacity>
                    <Icon name="edit" size={16} color="#9ca3af" />
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={styles.promoCardDescription}>
                {promo.description}
              </Text>

              <View style={styles.promoCardDetails}>
                <View style={styles.promoCardDetail}>
                  <Text style={styles.detailLabel}>Time:</Text>
                  <Text style={styles.detailValue}>
                    {promo.startTime} - {promo.endTime}
                  </Text>
                </View>
                <View style={styles.promoCardDetail}>
                  <Text style={styles.detailLabel}>Redemptions:</Text>
                  <Text style={styles.detailValueRed}>{promo.redemptions}</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[
                  styles.promoToggleButton,
                  promo.active
                    ? styles.deactivateButton
                    : styles.activateButton,
                ]}
              >
                <Text style={styles.promoToggleText}>
                  {promo.active ? "Deactivate" : "Activate"}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </ScrollView>
    );

    const PromoModal = () => (
      <Modal visible={showPromoModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.promoModalContent}>
            <View style={styles.promoModalHeader}>
              <Text style={styles.modalTitle}>Create Promotion</Text>
              <TouchableOpacity onPress={() => setShowPromoModal(false)}>
                <Icon name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.promoForm}>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Title</Text>
                <TextInput
                  style={styles.formInput}
                  value={newPromo.title}
                  onChangeText={(text) =>
                    setNewPromo({ ...newPromo, title: text })
                  }
                  placeholder="Happy Hour Special"
                  placeholderTextColor="#9ca3af"
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Description</Text>
                <TextInput
                  style={[styles.formInput, styles.textArea]}
                  value={newPromo.description}
                  onChangeText={(text) =>
                    setNewPromo({ ...newPromo, description: text })
                  }
                  placeholder="25% off all drinks"
                  placeholderTextColor="#9ca3af"
                  multiline
                  numberOfLines={3}
                />
              </View>

              <View style={styles.formRow}>
                <View style={styles.formHalf}>
                  <Text style={styles.formLabel}>Start Time</Text>
                  <TextInput
                    style={styles.formInput}
                    value={newPromo.startTime}
                    onChangeText={(text) =>
                      setNewPromo({ ...newPromo, startTime: text })
                    }
                    placeholder="18:00"
                    placeholderTextColor="#9ca3af"
                  />
                </View>
                <View style={styles.formHalf}>
                  <Text style={styles.formLabel}>End Time</Text>
                  <TextInput
                    style={styles.formInput}
                    value={newPromo.endTime}
                    onChangeText={(text) =>
                      setNewPromo({ ...newPromo, endTime: text })
                    }
                    placeholder="20:00"
                    placeholderTextColor="#9ca3af"
                  />
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowPromoModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.createPromoButton}
                onPress={() => {
                  setShowPromoModal(false);
                  Alert.alert("Success", "Promotion created!");
                }}
              >
                <Text style={styles.createPromoButtonText}>Create Promo</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );

    return (
      <SafeAreaView style={styles.dashboardContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />

        <View style={styles.dashboardHeader}>
          <View style={styles.dashboardHeaderLeft}>
            <View style={styles.dashboardIcon}>
              <Icon name="bar-chart" size={24} color="white" />
            </View>
            <View>
              <Text style={styles.dashboardTitle}>Scene Dashboard</Text>
              <Text style={styles.dashboardSubtitle}>{venue.name}</Text>
            </View>
          </View>
          <View style={styles.dashboardHeaderRight}>
            <TouchableOpacity style={styles.headerButton}>
              <Icon name="notifications" size={20} color="#f87171" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerButton}>
              <Icon name="settings" size={20} color="#f87171" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.dashboardTabs}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {[
              { id: "overview", icon: "bar-chart", label: "Overview" },
              { id: "promos", icon: "card-giftcard", label: "Promotions" },
              { id: "analytics", icon: "trending-up", label: "Analytics" },
            ].map((tab) => (
              <TouchableOpacity
                key={tab.id}
                style={[
                  styles.dashboardTab,
                  activeTab === tab.id && styles.activeDashboardTab,
                ]}
                onPress={() => setActiveTab(tab.id)}
              >
                <Icon
                  name={tab.icon}
                  size={20}
                  color={activeTab === tab.id ? "white" : "#9ca3af"}
                />
                <Text
                  style={[
                    styles.dashboardTabText,
                    activeTab === tab.id && styles.activeDashboardTabText,
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.dashboardMain}>
          {activeTab === "overview" && <Overview />}
          {activeTab === "promos" && <Promotions />}
        </View>

        <PromoModal />
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
});

export default SceneAppComplete;
