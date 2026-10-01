use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::State;

use crate::rpc::RpcError;
use crate::watcher::{rule_scope, Watchers};

const TICKET_LIFETIME: Duration = Duration::from_secs(3600);
const MAX_TICKETS: usize = 256;

struct Ticket {
    chain_id: String,
    expires: Instant,
}

#[derive(Default)]
pub struct WatchTickets(Mutex<HashMap<String, Ticket>>);

fn ticket_invalid() -> RpcError {
    RpcError::new(
        "TICKET_INVALID",
        "this file is not being handled by a watched folder",
    )
}

impl WatchTickets {
    pub fn issue(&self, chain_id: &str, now: Instant) -> Result<String, RpcError> {
        let mut tickets = self.0.lock().map_err(|_| ticket_invalid())?;
        tickets.retain(|_, ticket| ticket.expires > now);
        if tickets.len() >= MAX_TICKETS {
            return Err(RpcError::new("INVALID_PARAMS", "too many open tickets"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        tickets.insert(
            id.clone(),
            Ticket {
                chain_id: chain_id.to_string(),
                expires: now + TICKET_LIFETIME,
            },
        );
        Ok(id)
    }

    pub fn check(&self, ticket: &str, chain_id: &str, now: Instant) -> Result<(), RpcError> {
        let tickets = self.0.lock().map_err(|_| ticket_invalid())?;
        match tickets.get(ticket) {
            Some(found) if found.expires > now && found.chain_id == chain_id => Ok(()),
            _ => Err(ticket_invalid()),
        }
    }

    pub fn release(&self, ticket: &str) {
        if let Ok(mut tickets) = self.0.lock() {
            tickets.remove(ticket);
        }
    }
}

#[tauri::command]
pub fn watch_ticket(
    watchers: State<'_, Watchers>,
    tickets: State<'_, WatchTickets>,
    rule_id: String,
    path: String,
) -> Result<String, RpcError> {
    let scope = rule_scope(&watchers, &rule_id).ok_or_else(ticket_invalid)?;
    let chain_id = scope.chain_id.clone().ok_or_else(ticket_invalid)?;
    if !scope.covers(Path::new(&path)) {
        return Err(ticket_invalid());
    }
    tickets.issue(&chain_id, Instant::now())
}

#[tauri::command]
pub fn watch_ticket_release(tickets: State<'_, WatchTickets>, ticket: String) {
    tickets.release(&ticket);
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHAIN: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";

    #[test]
    fn a_ticket_works_for_its_chain_until_released_or_expired() {
        let tickets = WatchTickets::default();
        let now = Instant::now();
        let ticket = tickets.issue(CHAIN, now).unwrap();
        assert!(tickets.check(&ticket, CHAIN, now).is_ok());
        assert_eq!(
            tickets
                .check(&ticket, "7c9e6679-7425-40de-944b-e07fc1f90ae7", now)
                .unwrap_err()
                .code,
            "TICKET_INVALID"
        );
        assert!(tickets
            .check(
                &ticket,
                CHAIN,
                now + TICKET_LIFETIME + Duration::from_secs(1)
            )
            .is_err());
        assert!(tickets.check("made-up", CHAIN, now).is_err());
        tickets.release(&ticket);
        assert!(tickets.check(&ticket, CHAIN, now).is_err());
    }

    #[test]
    fn open_tickets_are_capped() {
        let tickets = WatchTickets::default();
        let now = Instant::now();
        for _ in 0..MAX_TICKETS {
            tickets.issue(CHAIN, now).unwrap();
        }
        assert!(tickets.issue(CHAIN, now).is_err());
        assert!(tickets
            .issue(CHAIN, now + TICKET_LIFETIME + Duration::from_secs(1))
            .is_ok());
    }
}
