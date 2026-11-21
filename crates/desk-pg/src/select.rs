//! The first of two futures to finish, the second asked first: how a session waits for the
//! server or its next call and stops when it is told to, without tokio's macros.

use std::future::{Future, poll_fn};
use std::pin::pin;
use std::task::Poll;

pub(crate) enum Either<A, B> {
    Left(A),
    Right(B),
}

/// Poll `right` first, then `left`; the one not finished is dropped. Both must be cancel-safe.
pub(crate) async fn select<A: Future, B: Future>(
    left: A,
    right: B,
) -> Either<A::Output, B::Output> {
    let mut left = pin!(left);
    let mut right = pin!(right);
    poll_fn(|cx| {
        if let Poll::Ready(value) = right.as_mut().poll(cx) {
            return Poll::Ready(Either::Right(value));
        }
        if let Poll::Ready(value) = left.as_mut().poll(cx) {
            return Poll::Ready(Either::Left(value));
        }
        Poll::Pending
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run<F: Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(future)
    }

    #[test]
    fn the_first_to_finish_wins_and_the_right_goes_first() {
        let slow = async { tokio::time::sleep(std::time::Duration::from_secs(5)).await };
        assert!(matches!(run(select(slow, async { 2 })), Either::Right(2)));
        assert!(matches!(
            run(select(async { 1 }, async { 2 })),
            Either::Right(2)
        ));
        let never = std::future::pending::<()>();
        assert!(matches!(run(select(async { 1 }, never)), Either::Left(1)));
    }
}
