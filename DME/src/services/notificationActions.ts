/**
 * Notification Action Handler
 * Handles notification action button presses (answer/reject call, reply to message)
 */

import notifee, { EventType } from '@notifee/react-native';
import api from './api';
import AsyncStorage from '@react-native-async-storage/async-storage';

class NotificationActionHandler {
  /**
   * Handle answer call action from notification
   * This accepts the call via WebSocket and navigates to CallScreen
   */
  async handleAnswerCall(callData: any) {
    try {
      console.log('[NotificationAction] Answering call:', callData);
      
      // Cancel the incoming call notification
      await notifee.cancelNotification('incoming_call_notification');
      
      // The actual call acceptance will happen in IncomingCallScreen
      // We just need to pass the data correctly
      return {
        action: 'answer_call',
        callData: {
          call_id: callData.call_id,
          caller_id: callData.caller_id,
          caller_name: callData.caller_name,
          call_type: callData.call_type,
        },
      };
    } catch (error) {
      console.error('[NotificationAction] Error answering call:', error);
      return null;
    }
  }

  /**
   * Handle reject call action from notification
   * This rejects the call via API and cancels notification
   */
  async handleRejectCall(callData: any) {
    try {
      console.log('[NotificationAction] Rejecting call:', callData);
      
      // Cancel the incoming call notification
      await notifee.cancelNotification('incoming_call_notification');
      
      // Call API to reject the call
      if (callData.call_id) {
        await api.post('/calls/reject/', { call_id: parseInt(callData.call_id, 10) });
        console.log('[NotificationAction] Call rejected via API');
      }
      
      return {
        action: 'reject_call',
        callId: callData.call_id,
      };
    } catch (error) {
      console.error('[NotificationAction] Error rejecting call:', error);
      return null;
    }
  }

  /**
   * Handle reply message action from notification
   * Sends the message and returns result
   */
  async handleReplyMessage(conversationId: number, replyText: string) {
    try {
      console.log('[NotificationAction] Reply to conversation:', conversationId, 'Text:', replyText);

      if (!replyText || !conversationId) {
        console.error('[NotificationAction] Missing reply text or conversation ID');
        return null;
      }

      // Send message via API
      const response = await api.post(`/chat/conversations/${conversationId}/messages/`, {
        content: replyText,
        message_type: 'text',
      });

      console.log('[NotificationAction] Message sent:', response.data);

      // Get current user ID from token or response
      const userId = response.data?.sender?.id || response.data?.sender_id;

      return {
        action: 'reply_message',
        conversationId,
        messageId: response.data?.id,
        senderId: userId,
        message: response.data,
      };
    } catch (error: any) {
      console.error('[NotificationAction] Error sending reply:', error);
      // Log detailed error for debugging
      if (error.response) {
        console.error('[NotificationAction] API error response:', error.response.status, error.response.data);
      }
      return null;
    }
  }
}

export default new NotificationActionHandler();
