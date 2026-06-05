import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Platform, Alert } from 'react-native';
import { launchCamera, launchImageLibrary, CameraOptions } from 'react-native-image-picker';
import { check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import { pick, types, errorCodes } from '@react-native-documents/picker';
import Icon from 'react-native-vector-icons/Ionicons';

interface MediaPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onMediaSelected: (asset: any, type: 'image' | 'video') => void;
  onDocumentSelected?: (doc: any) => void;
  top?: number;
  bottom?: number;
  right?: number;
  left?: number;
  mode?: 'camera' | 'attachment';
}

export const MediaPickerModal: React.FC<MediaPickerModalProps> = ({ 
    visible, onClose, onMediaSelected, onDocumentSelected, top, bottom, right, left, mode = 'camera' 
}) => {
  
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
        if (result.didCancel || result.errorCode || !result.assets?.[0]?.uri) return;
        
        onMediaSelected(result.assets[0], mode);
        onClose();
    } catch (error) {
        console.error('Camera error:', error);
        Alert.alert('Error', 'Could not open camera.');
    }
  };

  const handlePickGallery = async () => {
    try {
        const result = await launchImageLibrary({ mediaType: 'mixed', quality: 0.85 });
        if (result.didCancel || result.errorCode || !result.assets?.[0]?.uri) return;
        
        const asset = result.assets[0];
        onMediaSelected(asset, asset.type?.startsWith('video') ? 'video' : 'image');
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
                'com.rarlab.rar-archive', // RAR
                'application/x-zip-compressed' // ZIP
            ], 
            allowMultiSelection: false 
        });
        if (results?.[0]) {
            onDocumentSelected?.(results[0]);
            onClose();
        }
    } catch (err: any) {
        if (err?.code !== errorCodes.OPERATION_CANCELED) console.error('DocumentPicker error:', err);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableOpacity style={styles.overlay} onPress={onClose} activeOpacity={1}>
        <View style={[styles.popover, { top, bottom, right, left }]}>
          {mode === 'camera' ? (
            <>
              <TouchableOpacity style={styles.popoverItem} onPress={() => handleCapture('image')}>
                <Icon name="camera" size={24} color="#000000" />
                <Text style={styles.popoverText}>Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.popoverItem} onPress={() => handleCapture('video')}>
                <Icon name="videocam" size={24} color="#000000" />
                <Text style={styles.popoverText}>Video</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity style={styles.popoverItem} onPress={handlePickGallery}>
                <Icon name="images" size={24} color="#000000" />
                <Text style={styles.popoverText}>Gallery</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.popoverItem} onPress={handleDocumentPick}>
                <Icon name="document-text" size={24} color="#000000" />
                <Text style={styles.popoverText}>Document</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'transparent' },
  popover: { 
    position: 'absolute', width: 160, backgroundColor: '#fff', 
    borderRadius: 8, padding: 4, elevation: 5, shadowColor: '#000', 
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, zIndex: 9999 
  },
  popoverItem: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 16 },
  popoverText: { fontSize: 16, color: '#333' },
});
