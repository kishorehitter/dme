"""
WebSocket consumers for WebRTC call signaling.
Handles offer/answer/ICE candidate exchange between callers.
"""
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken
from .models import Call

User = get_user_model()

# Track active calls: {call_id: {caller_channel, receiver_channel, call_object}}
active_calls = {}


class CallConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for WebRTC call signaling.
    
    Connection URL: ws://localhost:8000/ws/call/?token=JWT_TOKEN
    
    Message types:
    - call_offer: Send WebRTC offer SDP
    - call_answer: Send WebRTC answer SDP
    - ice_candidate: Send ICE candidate
    - call_reject: Reject incoming call
    - call_end: End active call
    - call_ringing: Notify caller that receiver is ringing
    """

    async def connect(self):
        """Authenticate user and accept WebSocket connection."""
        # ✅ Extract call_id from URL route (now works with fixed routing.py)
        self.call_id = self.scope['url_route']['kwargs'].get('call_id')
        
        self.user = await self.get_user_from_token()
        if not self.user or not self.user.is_authenticated:
            print(f"   ❌ Call WebSocket rejected: user not authenticated")
            await self.close(code=4001)
            return

        # Join user's personal channel for receiving calls
        self.user_channel = f'user_{self.user.id}'
        await self.channel_layer.group_add(self.user_channel, self.channel_name)
        
        # ✅ ALSO join call-specific channel for targeted broadcasting
        if self.call_id:
            self.call_group = f'call_{self.call_id}'
            await self.channel_layer.group_add(self.call_group, self.channel_name)
            print(f"   ✅ User {self.user.id} joined call group: {self.call_group}")

        print(f"   📞 Call WebSocket CONNECT: user={self.user.id}, call_id={self.call_id}, channel={self.user_channel}")
        await self.accept()
        await self.send_pending_call_offer()

    async def send_pending_call_offer(self):
        """Check if there's a pending call offer for this user and send it directly."""
        print(f"   🔍 Checking pending calls for user {self.user.id}")
        print(f"   📋 Active calls: {list(active_calls.keys())}")

        # First, check in-memory active_calls (for WebSocket-initiated calls)
        for call_id, call_data in list(active_calls.items()):
            if call_data.get('receiver_id') == self.user.id and call_data.get('call_object'):
                # Refresh call object from database to get latest status
                call = await self.get_call_from_db(call_id)
                if call and call.status == 'ringing':
                    # Update the call_object in active_calls with fresh data
                    call_data['call_object'] = call

                    # Send pending offer directly to this WebSocket connection
                    print(f"   📞 Sending pending call offer {call_id} to user {self.user.id} (status={call.status})")
                    await self.send(text_data=json.dumps({
                        'type': 'call_offer',
                        'call_id': call_id,
                        'caller_id': call_data['caller_id'],
                        'caller_name': call.caller.display_name or call.caller.email,
                        'call_type': call.call_type,
                        'offer': call.offer_sdp,
                    }))
                    # Add to active_calls so ICE forwarding works
                    active_calls[call_id] = {
                        'caller_id': call_data['caller_id'],
                        'caller_user_channel': call_data.get('caller_user_channel', f'user_{call_data["caller_id"]}'),
                        'receiver_id': self.user.id,
                        'receiver_user_channel': f'user_{self.user.id}',
                        'call_object': call,
                    }
                    return
                else:
                    print(f"   ⚠️ Call {call_id} status is {call.status if call else 'None'}, not ringing")

        # If not found in memory, check DATABASE for pending ringing calls
        # This handles REST API-initiated calls where call_offer was sent before receiver connected
        print(f"   📡 Checking database for pending calls for user {self.user.id}...")
        pending_call = await self.get_pending_call_for_receiver(self.user.id)
        
        if pending_call:
            print(f"   📞 Found pending call {pending_call.id} in database for user {self.user.id}")
            # Add to active_calls for ICE forwarding
            active_calls[pending_call.id] = {
                'caller_id': pending_call.caller_id,
                'caller_user_channel': f'user_{pending_call.caller_id}',
                'receiver_id': self.user.id,
                'receiver_user_channel': f'user_{self.user.id}',
                'call_object': pending_call,
            }
            # Send the offer
            await self.send(text_data=json.dumps({
                'type': 'call_offer',
                'call_id': pending_call.id,
                'caller_id': pending_call.caller_id,
                'caller_name': pending_call.caller.display_name or pending_call.caller.email,
                'call_type': pending_call.call_type,
                'offer': pending_call.offer_sdp,
            }))
            print(f"   ✅ Sent pending call offer {pending_call.id} from database")
        else:
            print(f"   📭 No pending calls found for user {self.user.id}")

    @database_sync_to_async
    def get_pending_call_for_receiver(self, receiver_id):
        """Get a pending ringing call for this receiver from database."""
        from django.utils import timezone
        from datetime import timedelta
        
        # Look for ringing calls in the last 2 minutes
        cutoff_time = timezone.now() - timedelta(minutes=2)
        
        try:
            return Call.objects.select_related('caller').filter(
                receiver_id=receiver_id,
                status='ringing',
                started_at__gte=cutoff_time,
            ).order_by('-started_at').first()
        except Exception as e:
            print(f"   ❌ Error getting pending call: {e}")
            return None

    @database_sync_to_async
    def get_call_from_db(self, call_id):
        """Get fresh call object from database."""
        try:
            return Call.objects.select_related('caller').get(id=call_id)
        except Call.DoesNotExist:
            return None
        except Exception as e:
            print(f"   ❌ Error getting call: {e}")
            return None

    async def disconnect(self, close_code):
        """Clean up on disconnect."""
        if hasattr(self, 'user_channel'):
            await self.channel_layer.group_discard(self.user_channel, self.channel_name)
        
        # ✅ Clean up call-specific group
        if hasattr(self, 'call_group'):
            await self.channel_layer.group_discard(self.call_group, self.channel_name)
        
        await self.cleanup_active_calls()
        print(f"   📞 Call WebSocket DISCONNECT: user={self.user.id if hasattr(self, 'user') else 'unknown'}, call_id={getattr(self, 'call_id', None)}")

    async def cleanup_active_calls(self):
        """Clean up active calls when user disconnects (no auto-missed logic)."""
        if not hasattr(self, 'user'):
            return
        
        for call_id, call_data in list(active_calls.items()):
            if call_data.get('caller_id') == self.user.id or call_data.get('receiver_id') == self.user.id:
                if call_id in active_calls:
                    del active_calls[call_id]
                print(f"   🧹 Cleaned up call {call_id} from active_calls")

    async def notify_missed_call(self, call):
        """Send missed call FCM notification to receiver."""
        try:
            await self._send_missed_call_notification(call)
        except Exception as e:
            print(f"   ❌ Error sending missed call notification: {e}")

    @database_sync_to_async
    def _send_missed_call_notification(self, call):
        """Send missed call FCM notification (sync version for database_sync_to_async)."""
        try:
            from notifications.fcm_service import FCMService
            caller_name = call.caller.display_name or call.caller.email
            FCMService.send_missed_call_notification(
                recipient=call.receiver,
                caller_name=caller_name,
                caller_id=call.caller_id,
                call_id=call.id,
                call_type=call.call_type,
            )
            print(f"   📱 Sent missed call notification for call {call.id}")
        except Exception as e:
            print(f"   ❌ Error in _send_missed_call_notification: {e}")

    async def receive(self, text_data):
        """Receive and route signaling messages."""
        try:
            data = json.loads(text_data)
            message_type = data.get('type')
            print(f"   📩 Call signaling: {message_type}")

            if message_type == 'call_offer':
                await self.handle_call_offer(data)
            elif message_type == 'call_end':
                await self.handle_call_end(data)
            elif message_type == 'ice_candidate':
                await self.handle_ice_candidate(data)
            elif message_type == 'call_reject':
                await self.handle_call_reject(data)
            else:
                print(f"   ⚠️ Unknown message type: {message_type}")
        except json.JSONDecodeError:
            print(f"   ❌ Invalid JSON received")
        except Exception as e:
            print(f"   ❌ Error processing message: {e}")

    async def handle_call_offer(self, data):
        """Handle incoming call offer.
        
        NOTE: The call record should already exist (created via REST API).
        This handler just forwards the offer to the receiver via WebSocket.
        """
        receiver_id = data.get('receiver_id')
        call_type = data.get('call_type', 'audio')
        offer_data = data.get('offer')
        call_id = data.get('call_id')
        if call_id:
            try:
                call_id = int(call_id)
            except (ValueError, TypeError):
                pass


        if not receiver_id or not offer_data:
            await self.send_error("Missing receiver_id or offer")
            return

        # Extract SDP string from offer object
        if isinstance(offer_data, dict):
            offer_sdp = offer_data.get('sdp', '')
        else:
            offer_sdp = offer_data

        if not offer_sdp or not isinstance(offer_sdp, str):
            await self.send_error("Invalid offer SDP")
            return

        # Get existing call record (should already exist from REST API)
        call = await self.get_call_from_db(call_id)
        if not call:
            print(f"   ⚠️ Call {call_id} not found, creating new record...")
            # Fallback: create call record if it doesn't exist
            call = await self.create_call_record(self.user.id, receiver_id, call_type, offer_sdp)
            if not call:
                await self.send_error("Failed to create call record")
                return
        else:
            # Update the existing call record with offer SDP if not set
            if not call.offer_sdp:
                await self.save_offer_sdp(call_id, offer_sdp)

        # Store active call with user channels
        active_calls[call.id] = {
            'caller_id': self.user.id,
            'caller_user_channel': f'user_{self.user.id}',
            'receiver_id': receiver_id,
            'receiver_user_channel': f'user_{receiver_id}',
            'call_object': call,
        }

        # Update call status to ringing (if not already)
        if call.status != 'ringing':
            await self.update_call_status(call.id, 'ringing')

        # Send offer to receiver with proper format
        await self.channel_layer.group_send(
            f'user_{receiver_id}',
            {
                'type': 'call_offer',
                'call_id': call.id,
                'caller_id': self.user.id,
                'caller_name': self.user.display_name or self.user.email,
                'call_type': call_type,
                'offer': offer_sdp,  # Send SDP string directly
            }
        )

        print(f"   📞 Call offer sent: {call.id} ({self.user.email} -> {receiver_id})")
        print(f"   📋 Active calls updated: {list(active_calls.keys())}")

    async def handle_call_answer(self, data):
        """Handle call answer from receiver."""
        call_id = data.get('call_id')
        if call_id:
            try:
                call_id = int(call_id)
            except (ValueError, TypeError):
                pass

        answer_sdp = data.get('answer')

        if not call_id or not answer_sdp:
            print(f"   ❌ Missing call_id or answer: call_id={call_id}, answer={answer_sdp}")
            await self.send_error("Missing call_id or answer")
            return

        print(f"   ✅ Received call answer for call {call_id}")
        print(f"   📋 Active calls: {list(active_calls.keys())}")
        print(f"   📋 Call data for {call_id}: {active_calls.get(call_id)}")

        # Update call status
        await self.update_call_status(call_id, 'accepted')
        await self.save_answer_sdp(call_id, answer_sdp)

        # Get call data
        call_data = active_calls.get(call_id)
        if call_data:
            # Send answer to caller via their user channel
            caller_channel = call_data.get('caller_user_channel')
            if caller_channel:
                print(f"   📡 Sending answer to caller via user channel: {caller_channel}")
                await self.channel_layer.group_send(
                    caller_channel,
                    {
                        'type': 'call_answer',
                        'call_id': call_id,
                        'answer': answer_sdp,
                    }
                )

            # Store receiver's user channel for ICE forwarding
            call_data['receiver_user_channel'] = f'user_{self.user.id}'
            print(f"   📋 Call {call_id} now has receiver user channel: user_{self.user.id}")
            
            # FIX: Send buffered ICE candidates to caller
            await self.send_buffered_ice_candidates_to_caller(call_id)
            # FIX: Send buffered ICE candidates FOR receiver (from caller) to receiver
            await self.send_buffered_ice_candidates(call_id)
        else:
            # Call not in memory - try to get from database and notify caller via user channel
            print(f"   ⚠️ Call {call_id} not in active_calls, trying database...")
            call = await self.get_call_from_db(call_id)
            if call:
                # Send answer to caller via user channel
                caller_channel = f'user_{call.caller_id}'
                print(f"   📡 Sending answer to caller via restored channel: {caller_channel}")
                await self.channel_layer.group_send(
                    caller_channel,
                    {
                        'type': 'call_answer',
                        'call_id': call_id,
                        'answer': answer_sdp,
                    }
                )
                # Update active_calls with user channels for ICE forwarding
                active_calls[call_id] = {
                    'caller_id': call.caller_id,
                    'caller_user_channel': f'user_{call.caller_id}',
                    'receiver_id': call.receiver_id,
                    'receiver_user_channel': f'user_{call.receiver_id}',
                    'call_object': call,
                }
                print(f"   ✅ Call {call_id} restored from database with channels:")
                print(f"      Caller: user_{call.caller_id}")
                print(f"      Receiver: user_{call.receiver_id}")
                
                # FIX: Send buffered ICE candidates to caller
                await self.send_buffered_ice_candidates_to_caller(call_id)
                # FIX: Send buffered ICE candidates FOR receiver (from caller) to receiver
                await self.send_buffered_ice_candidates(call_id)

        print(f"   ✅ Call answered: {call_id}")

    async def send_buffered_ice_candidates_to_caller(self, call_id):
        """Send buffered ICE candidates from database to the caller."""
        print(f"   📤 Sending buffered ICE candidates for call {call_id} to caller")
        
        @database_sync_to_async
        def _get_candidates():
            try:
                call = Call.objects.get(id=call_id)
                candidates = call.ice_candidates or []
                print(f"   📋 Retrieved {len(candidates)} buffered ICE candidates")
                return list(candidates)  # Make a copy
            except Exception as e:
                print(f"   ❌ Error getting buffered candidates: {e}")
                return []
        
        candidates = await _get_candidates()
        
        # Get call data to find caller channel
        call_data = active_calls.get(call_id)
        if not call_data:
            call = await self.get_call_from_db(call_id)
            if call:
                caller_channel = f'user_{call.caller_id}'
            else:
                print(f"   ❌ Call {call_id} not found")
                return
        else:
            caller_channel = call_data.get('caller_user_channel')
        
        if not caller_channel:
            print(f"   ❌ No caller channel found for call {call_id}")
            return
        
        # Send each candidate to the caller
        for candidate in candidates:
            await self.channel_layer.group_send(
                caller_channel,
                {
                    'type': 'ice_candidate',
                    'call_id': call_id,
                    'candidate': candidate,
                }
            )
        
        print(f"   ✅ Sent {len(candidates)} buffered ICE candidates to caller via {caller_channel}")


    async def handle_ice_candidate(self, data):
        """Handle ICE candidate exchange."""
        call_id = data.get('call_id')
        if call_id:
            try:
                call_id = int(call_id)
            except (ValueError, TypeError):
                pass

        candidate = data.get('candidate')

        if not call_id or not candidate:
            # Silently ignore invalid ICE candidates
            return

        print(f"   📩 ICE candidate received for call {call_id}")
        print(f"   📋 Active calls: {list(active_calls.keys())}")

        # Get call data
        call_data = active_calls.get(call_id)
        if not call_data:
            # Try to restore from database
            print(f"   ⚠️ Call {call_id} not in active_calls, trying database...")
            call = await self.get_call_from_db(call_id)
            if call:
                # Restore call with user channels
                active_calls[call_id] = {
                    'caller_id': call.caller_id,
                    'caller_user_channel': f'user_{call.caller_id}',
                    'receiver_id': call.receiver_id,
                    'receiver_user_channel': f'user_{call.receiver_id}',
                    'call_object': call,
                }
                call_data = active_calls[call_id]
                print(f"   ✅ Call {call_id} restored for ICE forwarding")
            else:
                print(f"   ❌ Call {call_id} not found in database, dropping ICE candidate")
                return

        # Determine target user channel (send to OTHER party)
        # IMPORTANT: Use user channels (user_X), NOT raw channel names
        target_channel = None
        current_user_id = self.user.id if hasattr(self, 'user') else None

        if current_user_id == call_data.get('receiver_id'):
            # We're the receiver, candidate is for caller
            target_channel = call_data.get('caller_user_channel')
            print(f"   📤 Forwarding ICE to caller: {target_channel}")
        else:
            # We're the caller, send to receiver's user channel
            target_channel = call_data.get('receiver_user_channel')
            print(f"   📤 Forwarding ICE to receiver: {target_channel}")

        if target_channel:
            # Send ICE candidate to other party via their user channel
            await self.channel_layer.group_send(
                target_channel,
                {
                    'type': 'ice_candidate',
                    'call_id': call_id,
                    'candidate': candidate,
                }
            )
            print(f"   ✅ ICE candidate forwarded to {target_channel}")
        else:
            # FIX: Receiver not connected yet - store ICE candidate in database
            print(f"   💾 Receiver not connected, buffering ICE candidate in database for call {call_id}")
            await self.buffer_ice_candidate(call_id, candidate)

    async def buffer_ice_candidate(self, call_id, candidate):
        """Store ICE candidate in database for later delivery."""
        @database_sync_to_async
        def _buffer_candidate():
            try:
                call = Call.objects.get(id=call_id)
                # Initialize ice_candidates if None
                if call.ice_candidates is None:
                    call.ice_candidates = []
                # Append candidate
                call.ice_candidates.append(candidate)
                call.save(update_fields=['ice_candidates'])
                print(f"   ✅ Buffered ICE candidate for call {call_id} (total: {len(call.ice_candidates)})")
            except Call.DoesNotExist:
                print(f"   ❌ Call {call_id} not found for buffering ICE candidate")
            except Exception as e:
                print(f"   ❌ Error buffering ICE candidate: {e}")
        
        await _buffer_candidate()

    async def send_buffered_ice_candidates(self, call_id):
        """Send all buffered ICE candidates to the receiver."""
        print(f"   📤 Sending buffered ICE candidates for call {call_id}")
        
        @database_sync_to_async
        def _get_and_clear_candidates():
            try:
                call = Call.objects.get(id=call_id)
                candidates = call.ice_candidates or []
                # Clear the buffer
                call.ice_candidates = []
                call.save(update_fields=['ice_candidates'])
                print(f"   📋 Retrieved {len(candidates)} buffered ICE candidates")
                return candidates
            except Exception as e:
                print(f"   ❌ Error getting buffered candidates: {e}")
                return []
        
        candidates = await _get_and_clear_candidates()
        
        # Send each candidate to the receiver
        for candidate in candidates:
            await self.channel_layer.group_send(
                f'user_{self.user.id}',
                {
                    'type': 'ice_candidate',
                    'call_id': call_id,
                    'candidate': candidate,
                }
            )
        
        print(f"   ✅ Sent {len(candidates)} buffered ICE candidates to user {self.user.id}")


    async def handle_call_reject(self, data):
        """Handle call rejection - only notify the CALLER"""
        call_id = data.get('call_id')
        
        if call_id:
            try:
                call_id = int(call_id)
            except (ValueError, TypeError):
                pass

        if not call_id:
            await self.send_error("Missing call_id")
            return

        print(f"   📩 Call signaling: call_reject")
        
        # Update call status in database
        await self.reject_call(call_id)

        # Get call data from active_calls
        call_data = active_calls.get(call_id)
        
        if call_data:
            caller_channel = call_data.get('caller_user_channel')
            caller_id = call_data.get('caller_id')
            
            # CRITICAL: Only send rejection to CALLER, not receiver
            if caller_channel and self.user.id != caller_id:
                print(f"   📡 Sent call rejection to caller {caller_id} via WebSocket")
                await self.channel_layer.group_send(
                    caller_channel,
                    {
                        'type': 'call_rejected',
                        'call_id': call_id,
                    }
                )
            elif self.user.id == caller_id:
                print(f"   ℹ️  Caller {caller_id} is rejecting own call (rare)")
                # Notify receiver instead
                receiver_channel = call_data.get('receiver_user_channel')
                if receiver_channel:
                    await self.channel_layer.group_send(
                        receiver_channel,
                        {
                            'type': 'call_rejected',
                            'call_id': call_id,
                        }
                    )
            else:
                print(f"   ⚠️  No caller channel found for call {call_id}")

        # Clean up active call
        if call_id in active_calls:
            del active_calls[call_id]
            print(f"   🗑️  Removed call {call_id} from active_calls")

        print(f"   ❌ Call rejected: {call_id}")

    async def handle_call_end(self, data):
        """Handle call end."""
        # ✅ Prefer call_id from URL, fallback to message data
        call_id = self.call_id or data.get('call_id')
        if call_id:
            try:
                call_id = int(call_id)
            except (ValueError, TypeError):
                pass

        if not call_id:
            await self.send_error("Missing call_id")
            return

        print(f"   🔚 handle_call_end: call_id={call_id}, ending_user={self.user.id}")

        # End the call in database
        await self.end_call(call_id)

        # ✅ PRIMARY: Broadcast to call-specific group (most reliable)
        call_group = f'call_{call_id}'
        print(f"   📤 Broadcasting call_end to group: {call_group}")
        await self.channel_layer.group_send(
            call_group,
            {
                'type': 'call_end',
                'call_id': call_id,
                'ending_user_id': self.user.id,
            }
        )

        # ✅ SECONDARY: Also send via user channels as fallback
        # This is now mostly handled by CallEndView in views.py, but kept for redundancy
        call_data = active_calls.get(call_id)
        if call_data:
            caller_channel = f'user_{call_data.get("caller_id")}'
            receiver_channel = f'user_{call_data.get("receiver_id")}'
            
            if self.user.id != call_data.get('caller_id'):
                await self.channel_layer.group_send(caller_channel, {
                    'type': 'call_end', 'call_id': call_id, 'ended_by': 'remote'
                })
            if self.user.id != call_data.get('receiver_id'):
                await self.channel_layer.group_send(receiver_channel, {
                    'type': 'call_end', 'call_id': call_id, 'ended_by': 'remote'
                })

        # Clean up
        if call_id in active_calls:
            del active_calls[call_id]

        print(f"   ✅ Call ended broadcast complete: {call_id}")

    async def call_offer(self, event):
        """Send call offer to receiver."""
        await self.send(text_data=json.dumps({
            'type': 'call_offer',
            'call_id': event['call_id'],
            'caller_id': event['caller_id'],
            'caller_name': event['caller_name'],
            'call_type': event['call_type'],
            'offer': event['offer'],
        }))

    async def call_answer(self, event):
        """Send call answer to caller."""
        await self.send(text_data=json.dumps({
            'type': 'call_answer',
            'call_id': event['call_id'],
            'answer': event['answer'],
        }))

    async def ice_candidate(self, event):
        """Send ICE candidate to peer."""
        await self.send(text_data=json.dumps({
            'type': 'ice_candidate',
            'call_id': event['call_id'],
            'candidate': event['candidate'],
        }))

    async def call_rejected(self, event):
        """Notify caller that call was rejected."""
        await self.send(text_data=json.dumps({
            'type': 'call_rejected',
            'call_id': event['call_id'],
        }))

    async def call_end(self, event):
        """Notify parties that call ended."""
        print(f"   📡 call_end method invoked, payload: {event}")
        
        # Determine ended_by (local vs remote)
        ended_by = event.get('ended_by')
        if not ended_by:
            ending_user_id = event.get('ending_user_id')
            if ending_user_id:
                ended_by = 'local' if hasattr(self, 'user') and self.user.id == ending_user_id else 'remote'
            else:
                ended_by = 'unknown'

        await self.send(text_data=json.dumps({
            'type': 'call_end',
            'call_id': event['call_id'],
            'ended_by': ended_by,
        }))

    async def call_ended(self, event):
        """Alias for call_end to prevent 'No handler' errors."""
        await self.call_end(event)

    async def call_accepted(self, event):
        """Notify that the call was accepted."""
        await self.send(text_data=json.dumps({
            'type': 'call_accepted',
            'call_id': event['call_id'],
        }))

    async def send_error(self, message):
        """Send error message."""
        await self.send(text_data=json.dumps({
            'type': 'error',
            'message': message,
        }))

    @database_sync_to_async
    def create_call_record(self, caller_id, receiver_id, call_type, offer_sdp):
        """Create a new call record."""
        try:
            call = Call.objects.create(
                caller_id=caller_id,
                receiver_id=receiver_id,
                call_type=call_type,
                status='initiated',
                offer_sdp=offer_sdp,
            )
            return call
        except Exception as e:
            print(f"   ❌ Error creating call: {e}")
            return None

    @database_sync_to_async
    def update_call_status(self, call_id, status):
        """Update call status."""
        try:
            Call.objects.filter(id=call_id).update(status=status)
            print(f"   ✅ Call {call_id} status updated to: {status}")
        except Exception as e:
            print(f"   ❌ Error updating call status: {e}")

    @database_sync_to_async
    def save_answer_sdp(self, call_id, answer_sdp):
        """Save answer SDP to call record."""
        try:
            Call.objects.filter(id=call_id).update(answer_sdp=answer_sdp)
        except Exception as e:
            print(f"   ❌ Error saving answer SDP: {e}")

    @database_sync_to_async
    def save_offer_sdp(self, call_id, offer_sdp):
        """Save offer SDP to call record."""
        try:
            Call.objects.filter(id=call_id).update(offer_sdp=offer_sdp)
        except Exception as e:
            print(f"   ❌ Error saving offer SDP: {e}")

    @database_sync_to_async
    def reject_call(self, call_id):
        """Reject a call."""
        try:
            call = Call.objects.get(id=call_id)
            call.reject_call()
        except Exception as e:
            print(f"   ❌ Error rejecting call: {e}")

    @database_sync_to_async
    def end_call(self, call_id):
        """End a call."""
        try:
            call = Call.objects.get(id=call_id)
            call.end_call()
        except Exception as e:
            print(f"   ❌ Error ending call: {e}")

    async def get_user_from_token(self):
        """Get user from JWT token in query params."""
        try:
            query_params = self.scope.get('query_string', b'').decode()
            params = dict(param.split('=') for param in query_params.split('&') if '=' in param)
            token = params.get('token', '')
            
            if not token:
                return None
            
            access_token = AccessToken(token)
            user_id = access_token['user_id']
            return await self.get_user(user_id)
        except Exception as e:
            print(f"   ❌ Error authenticating WebSocket token: {e}")
            return None

    @database_sync_to_async
    def get_user(self, user_id):
        """Get user by ID."""
        try:
            return User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return None
