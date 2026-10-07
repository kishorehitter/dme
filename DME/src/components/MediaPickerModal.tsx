import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Platform, Alert } from 'react-native';
import { launchCamera, launchImageLibrary, CameraOptions } from 'react-native-image-picker';
import { check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import { pick, types, errorCodes } from '@react-native-documents/picker';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';

interface MediaPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onMediaSelected: (assets: any[]) => void;
  onDocumentSelected?: (docs: any[]) => void;
  onOpenGallery?: () => void;
  top?: number;
  bottom?: number;
  right?: number;
  left?: number;
  mode?: 'camera' | 'attachment';
}

export const MediaPickerModal: React.FC<MediaPickerModalProps> = ({ 
    visible, onClose, onMediaSelected, onDocumentSelected, onOpenGallery, top, bottom, right, left, mode = 'camera' 
}) => {
  const { theme } = useTheme();
  const styles = dynamicStyles(theme);
  
  const handleCapture = async (mode: 'image' | 'video') => {
    const perm = Platform.OS === 'ios' ? PERMISSIONS.IOS.CAMERA : PERMISSIONS.ANDROID.CAMERA;
    const status = await check(perm);
    
    if (status !== RESULTS.GRANTED) {
        const result = await request(perm);
        if (result !== RESULTS.GRANTED) {
            Alert.alert('Permission Denied', 'Camera access is required.');
            return;
        }
    }

    try {
        const options: CameraOptions = mode === 'image' 
            ? { mediaType: 'photo', quality: 0.8, saveToPhotos: false } 
            : { mediaType: 'video', videoQuality: 'high', durationLimit: 60, saveToPhotos: false };

        const result = await launchCamera(options);
        if (result.didCancel || result.errorCode || !result.assets?.length) return;
        
        onMediaSelected(result.assets);
        onClose();
    } catch (error) {
        console.error('Camera error:', error);
        Alert.alert('Error', 'Could not open camera.');
    }
  };

  const handlePickGallery = async () => {
    try {
        const result = await launchImageLibrary({ mediaType: 'mixed', quality: 0.85, selectionLimit: 0 });
        if (result.didCancel || result.errorCode || !result.assets?.length) return;
        
        onMediaSelected(result.assets);
        onClose();
    } catch (error) {
        console.error('Gallery error:', error);
    }
  };

  const handleDocumentPick = async () => {
    try {
        const results = await pick({ 
            type: [
                types.pdf,
                types.doc,
                types.docx,
                types.xls,
                types.xlsx,
                types.ppt,
                types.pptx,
                types.plainText,
                types.zip,
                types.audio,
                'com.rarlab.rar-archive', // RAR
                'application/x-zip-compressed' // ZIP
            ], 
            allowMultiSelection: true 
        });
        if (results && results.length > 0) {
            onDocumentSelected?.(results);
            onClose();
        }
    } catch (err: any) {
        if (err?.code !== errorCodes.OPERATION_CANCELED) console.error('DocumentPicker error:', err);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableOpacity style={styles.overlay} onPress={onClose} activeOpacity={1}>
        <View style={[styles.popover, { top, bottom, right, left, width: mode === 'attachment' ? 240 : 160 }]}>
          {mode === 'camera' ? (
            <>
              <TouchableOpacity style={styles.popoverItem} onPress={() => handleCapture('image')}>
                <Icon name="camera" size={24} color={theme.icon} />
                <Text style={styles.popoverText}>Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.popoverItem} onPress={() => handleCapture('video')}>
                <Icon name="videocam" size={24} color={theme.icon} />
                <Text style={styles.popoverText}>Video</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <TouchableOpacity style={styles.gridItem} onPress={() => handleCapture('image')}>
                <View style={[styles.iconCircle, { backgroundColor: '#FF4081' }]}>
                  <Icon name="camera" size={24} color="#FFF" />
                </View>
                <Text style={styles.gridText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.gridItem} onPress={() => handleCapture('video')}>
                <View style={[styles.iconCircle, { backgroundColor: '#F44336' }]}>
                  <Icon name="videocam" size={24} color="#FFF" />
                </View>
                <Text style={styles.gridText}>Video</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.gridItem} onPress={() => {
                onClose();
                onOpenGallery ? onOpenGallery() : handlePickGallery();
              }}>
                <View style={[styles.iconCircle, { backgroundColor: '#E040FB' }]}>
                  <Icon name="images" size={24} color="#FFF" />
                </View>
                <Text style={styles.gridText}>Gallery</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.gridItem} onPress={handleDocumentPick}>
                <View style={[styles.iconCircle, { backgroundColor: '#536DFE' }]}>
                  <Icon name="document-text" size={24} color="#FFF" />
                </View>
                <Text style={styles.gridText}>Document</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const dynamicStyles = (theme: import('../utils/theme').ThemeColors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'transparent' },
  popover: { 
    position: 'absolute', backgroundColor: theme.surface, 
    borderRadius: 16, padding: 8, elevation: 5, shadowColor: '#000', 
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, zIndex: 9999 
  },
  popoverItem: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 16 },
  popoverText: { fontSize: 16, color: theme.textPrimary },
  gridItem: { width: '50%', paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  iconCircle: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  gridText: { fontSize: 13, color: theme.textPrimary, fontWeight: '500' },
});
